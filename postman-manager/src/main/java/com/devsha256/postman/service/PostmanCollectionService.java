package com.devsha256.postman.service;

import com.devsha256.postman.model.PostmanCollection;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.stream.Stream;

/**
 * Service class for managing Postman collections
 * Provides functionality to split and merge collections with environment grouping
 */
@Service
public class PostmanCollectionService {

    private static final Logger log = LoggerFactory.getLogger(PostmanCollectionService.class);

    private final ObjectMapper objectMapper;

    // Resource pattern to extract - everything from /ws/rest/ onwards
    private static final String RESOURCE_PATTERN = "/ws/rest/";

    public PostmanCollectionService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    /**
     * Feature 1: Split collection by grouping requests with same method+resource across environments
     * Groups Mule Dev, Mule QA, and Boomi requests that target the same resource
     *
     * @param sourceFilePath Path to the source Postman collection JSON file
     * @param outputDir Directory where grouped collections will be created
     * @throws IOException if file operations fail
     */
    public void splitCollectionIntoIndividualRequests(String sourceFilePath, String outputDir) throws IOException {
        log.info("Reading source collection from: {}", sourceFilePath);

        // Validate source file exists
        File sourceFile = new File(sourceFilePath);
        if (!sourceFile.exists()) {
            throw new IOException("Source file not found: " + sourceFilePath);
        }

        // Read the source collection
        PostmanCollection sourceCollection = objectMapper.readValue(sourceFile, PostmanCollection.class);

        // Create output directory if it doesn't exist
        Files.createDirectories(Paths.get(outputDir));

        // Extract all items (requests) from the collection
        List<PostmanCollection.Item> allItems = extractAllItems(sourceCollection.getItem());

        log.info("Found {} requests in the collection", allItems.size());

        // Group requests by method + normalized resource
        Map<String, List<PostmanCollection.Item>> groupedRequests = groupRequestsByResource(allItems);

        log.info("Grouped into {} unique resources", groupedRequests.size());

        // Create one collection per group
        int count = 0;
        for (Map.Entry<String, List<PostmanCollection.Item>> entry : groupedRequests.entrySet()) {
            String groupKey = entry.getKey();
            List<PostmanCollection.Item> requests = entry.getValue();

            // Create collection with all requests in this group
            PostmanCollection newCollection = createGroupedCollection(requests, sourceCollection, groupKey);

            // Use the resource name as the collection name
            String fileName = sanitizeFileName(groupKey) + ".json";
            String outputPath = outputDir + File.separator + fileName;

            objectMapper.writerWithDefaultPrettyPrinter()
                    .writeValue(new File(outputPath), newCollection);

            count++;
            log.info("Created collection {}/{}: {} ({} requests)",
                    count, groupedRequests.size(), groupKey, requests.size());

            // Log all requests in this group
            for (PostmanCollection.Item req : requests) {
                log.debug("  - {}", req.getName());
            }
        }

        log.info("Successfully created {} grouped collections in: {}", count, outputDir);
    }

    /**
     * Feature 2: Merge collections by grouping requests with same method+resource into folders
     * Each unique resource becomes a folder containing all environment variants
     *
     * @param sourceFolderPath Path to folder containing multiple Postman collections
     * @param outputFilePath Path where the merged collection will be saved
     * @throws IOException if file operations fail
     */
    public void mergeCollectionsFromFolder(String sourceFolderPath, String outputFilePath) throws IOException {
        log.info("Reading collections from folder: {}", sourceFolderPath);

        // Validate source folder exists
        File sourceFolder = new File(sourceFolderPath);
        if (!sourceFolder.exists() || !sourceFolder.isDirectory()) {
            throw new IOException("Source folder not found or is not a directory: " + sourceFolderPath);
        }

        // Extract collection name from output file path
        String collectionName = extractCollectionNameFromFilePath(outputFilePath);

        // Collect all requests from all collections
        List<PostmanCollection.Item> allRequests = new ArrayList<>();
        List<PostmanCollection.Variable> allVariables = new ArrayList<>();

        // Find all JSON files in the folder
        try (Stream<Path> paths = Files.walk(Paths.get(sourceFolderPath))) {
            List<Path> jsonFiles = paths
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .toList();

            log.info("Found {} JSON files to merge", jsonFiles.size());

            if (jsonFiles.isEmpty()) {
                throw new IOException("No JSON files found in folder: " + sourceFolderPath);
            }

            int successCount = 0;
            for (Path jsonFile : jsonFiles) {
                try {
                    PostmanCollection collection = objectMapper.readValue(jsonFile.toFile(), PostmanCollection.class);

                    // Extract all requests
                    List<PostmanCollection.Item> requests = extractAllItems(collection.getItem());
                    allRequests.addAll(requests);

                    // Collect variables
                    if (collection.getVariable() != null) {
                        for (PostmanCollection.Variable var : collection.getVariable()) {
                            boolean exists = allVariables.stream()
                                    .anyMatch(v -> v.getKey().equals(var.getKey()));
                            if (!exists) {
                                allVariables.add(var);
                            }
                        }
                    }

                    successCount++;
                    log.info("Loaded collection {}/{}: {} ({} requests)",
                            successCount, jsonFiles.size(),
                            collection.getInfo().getName(),
                            requests.size());
                } catch (Exception e) {
                    log.error("Failed to process file: {}. Error: {}", jsonFile.getFileName(), e.getMessage());
                }
            }

            if (successCount == 0) {
                throw new IOException("Failed to merge any collections. Check if files are valid Postman collections.");
            }
        }

        // Group requests by method + resource
        Map<String, List<PostmanCollection.Item>> groupedRequests = groupRequestsByResource(allRequests);

        log.info("Grouped {} requests into {} unique resources", allRequests.size(), groupedRequests.size());

        // Create merged collection with folders
        PostmanCollection mergedCollection = createMergedCollectionWithFolders(
                collectionName, groupedRequests, allVariables);

        // Create output directory if it doesn't exist
        File outputFile = new File(outputFilePath);
        if (outputFile.getParentFile() != null) {
            Files.createDirectories(outputFile.getParentFile().toPath());
        }

        // Write merged collection to output file
        objectMapper.writerWithDefaultPrettyPrinter()
                .writeValue(outputFile, mergedCollection);

        log.info("Successfully merged into collection '{}' with {} folders: {}",
                collectionName, groupedRequests.size(), outputFilePath);
    }

    /**
     * Group requests by METHOD + normalized resource path
     *
     * Grouping Logic:
     * 1. Extract HTTP method (GET, POST, PUT, DELETE, etc.)
     * 2. Extract URL and remove everything up to /ws/rest/
     * 3. Remove query parameters
     * 4. Group key = METHOD + resource path
     *
     * Examples:
     *   GET https://mule-dev.com/test-app-dev/ws/rest/GetCustomer?id=123
     *   GET https://mule-qa.com/test-app-qa/ws/rest/GetCustomer?id=456
     *   GET https://boomi-pp.com/ws/rest/GetCustomer
     *
     * All grouped as: "GET /ws/rest/GetCustomer"
     */
    private Map<String, List<PostmanCollection.Item>> groupRequestsByResource(List<PostmanCollection.Item> items) {
        Map<String, List<PostmanCollection.Item>> grouped = new LinkedHashMap<>();

        for (PostmanCollection.Item item : items) {
            if (item.getRequest() == null) {
                continue;
            }

            try {
                // Extract method
                String method = extractMethod(item);

                // Extract normalized resource (everything from /ws/rest/ onwards, without query params)
                String normalizedResource = extractNormalizedResource(item);

                // Create group key: "METHOD /ws/rest/ResourceName"
                String groupKey = method + " " + normalizedResource;

                // Add to group
                grouped.computeIfAbsent(groupKey, k -> new ArrayList<>()).add(item);

                log.debug("Grouped '{}' -> '{}'", item.getName(), groupKey);

            } catch (Exception e) {
                log.warn("Could not process request '{}': {}", item.getName(), e.getMessage());
            }
        }

        return grouped;
    }

    /**
     * Extract HTTP method from request item
     */
    private String extractMethod(PostmanCollection.Item item) {
        try {
            Map<String, Object> request = (Map<String, Object>) item.getRequest();
            Object methodObj = request.get("method");

            if (methodObj != null) {
                return methodObj.toString().toUpperCase();
            }
        } catch (Exception e) {
            log.debug("Could not extract method from request: {}", e.getMessage());
        }

        return "GET"; // Default
    }

    /**
     * Extract and normalize resource path from request URL
     *
     * Logic:
     * 1. Get the URL string
     * 2. Find /ws/rest/ in the URL
     * 3. Extract everything from /ws/rest/ onwards
     * 4. Remove query parameters (everything after ?)
     *
     * Examples:
     *   https://mule-dev.com/test-app-dev/ws/rest/GetCustomer?id=123 -> /ws/rest/GetCustomer
     *   https://mule-qa.com/test-app-qa/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     *   https://boomi-pp.com/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     *   https://mule-dev.com/app-dev/ws/rest/CreateOrder?type=new -> /ws/rest/CreateOrder
     */
    private String extractNormalizedResource(PostmanCollection.Item item) {
        try {
            Map<String, Object> request = (Map<String, Object>) item.getRequest();
            Object urlObj = request.get("url");

            String urlString = extractUrlString(urlObj);

            if (urlString == null || urlString.isEmpty()) {
                log.warn("Empty URL for request: {}", item.getName());
                return "/" + sanitizeFileName(item.getName());
            }

            log.debug("Processing URL: {}", urlString);

            // Find the position of /ws/rest/
            int resourceStartIndex = urlString.indexOf(RESOURCE_PATTERN);

            if (resourceStartIndex == -1) {
                log.warn("URL does not contain '{}': {}", RESOURCE_PATTERN, urlString);
                // Fallback: try to extract path from URI
                return extractPathFallback(urlString, item.getName());
            }

            // Extract everything from /ws/rest/ onwards
            String resourcePath = urlString.substring(resourceStartIndex);

            // Remove query parameters (everything after ?)
            int queryIndex = resourcePath.indexOf('?');
            if (queryIndex != -1) {
                resourcePath = resourcePath.substring(0, queryIndex);
            }

            // Remove fragment (everything after #)
            int fragmentIndex = resourcePath.indexOf('#');
            if (fragmentIndex != -1) {
                resourcePath = resourcePath.substring(0, fragmentIndex);
            }

            log.debug("Normalized resource: {}", resourcePath);

            return resourcePath;

        } catch (Exception e) {
            log.error("Error extracting resource from request '{}': {}", item.getName(), e.getMessage());
            return "/" + sanitizeFileName(item.getName());
        }
    }

    /**
     * Fallback method to extract path when /ws/rest/ pattern is not found
     */
    private String extractPathFallback(String urlString, String itemName) {
        try {
            URI uri = new URI(urlString);
            String path = uri.getPath();

            if (path != null && !path.isEmpty()) {
                // Remove query params from path if any
                int queryIndex = path.indexOf('?');
                if (queryIndex != -1) {
                    path = path.substring(0, queryIndex);
                }
                return path;
            }
        } catch (URISyntaxException e) {
            log.debug("Failed to parse URI: {}", e.getMessage());
        }

        return "/" + sanitizeFileName(itemName);
    }

    /**
     * Extract URL string from various Postman URL formats
     * Handles both string URLs and complex URL objects
     */
    private String extractUrlString(Object urlObj) {
        if (urlObj == null) {
            return null;
        }

        // If URL is a simple string
        if (urlObj instanceof String) {
            return (String) urlObj;
        }

        // If URL is an object with 'raw' field
        if (urlObj instanceof Map) {
            Map<String, Object> urlMap = (Map<String, Object>) urlObj;
            Object raw = urlMap.get("raw");
            if (raw != null) {
                return raw.toString();
            }

            // Try 'href' field as fallback
            Object href = urlMap.get("href");
            if (href != null) {
                return href.toString();
            }
        }

        return urlObj.toString();
    }

    /**
     * Create a collection containing all requests from a group
     * Used for SPLIT operation
     */
    private PostmanCollection createGroupedCollection(List<PostmanCollection.Item> requests,
                                                      PostmanCollection sourceCollection,
                                                      String groupKey) {
        PostmanCollection newCollection = new PostmanCollection();

        // Create info
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(groupKey);
        info.setDescription("Collection for " + groupKey + " across all environments");
        info.setSchema(sourceCollection.getInfo().getSchema());
        newCollection.setInfo(info);

        // Add all requests from this group
        newCollection.setItem(new ArrayList<>(requests));

        // Copy variables and auth from source
        if (sourceCollection.getVariable() != null) {
            newCollection.setVariable(new ArrayList<>(sourceCollection.getVariable()));
        } else {
            newCollection.setVariable(new ArrayList<>());
        }
        newCollection.setAuth(sourceCollection.getAuth());

        return newCollection;
    }

    /**
     * Create merged collection with folder structure
     * Each unique method+resource becomes a folder containing all environment variants
     * Used for MERGE operation
     */
    private PostmanCollection createMergedCollectionWithFolders(String collectionName,
                                                                Map<String, List<PostmanCollection.Item>> groupedRequests,
                                                                List<PostmanCollection.Variable> variables) {
        PostmanCollection mergedCollection = new PostmanCollection();

        // Create info
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(collectionName);
        info.setDescription("Merged collection with " + groupedRequests.size() + " resource groups");
        info.setSchema("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
        mergedCollection.setInfo(info);

        // Create folders for each group
        List<PostmanCollection.Item> folders = new ArrayList<>();

        for (Map.Entry<String, List<PostmanCollection.Item>> entry : groupedRequests.entrySet()) {
            String groupKey = entry.getKey();
            List<PostmanCollection.Item> requests = entry.getValue();

            // Create folder
            PostmanCollection.Item folder = new PostmanCollection.Item();
            folder.setName(groupKey);
            folder.setDescription("Requests for " + groupKey + " across environments (" + requests.size() + " variants)");
            folder.setItem(new ArrayList<>(requests));

            folders.add(folder);
        }

        mergedCollection.setItem(folders);
        mergedCollection.setVariable(variables);

        return mergedCollection;
    }

    /**
     * Extract collection name from output file path (without .json extension)
     */
    private String extractCollectionNameFromFilePath(String filePath) {
        File file = new File(filePath);
        String fileName = file.getName();

        if (fileName.toLowerCase().endsWith(".json")) {
            fileName = fileName.substring(0, fileName.length() - 5);
        }

        if (fileName.trim().isEmpty()) {
            return "Merged Collection";
        }

        return fileName;
    }

    /**
     * Recursively extract all items from nested folders
     */
    private List<PostmanCollection.Item> extractAllItems(List<PostmanCollection.Item> items) {
        List<PostmanCollection.Item> allItems = new ArrayList<>();

        if (items == null) {
            return allItems;
        }

        for (PostmanCollection.Item item : items) {
            if (item.getItem() != null && !item.getItem().isEmpty()) {
                allItems.addAll(extractAllItems(item.getItem()));
            } else if (item.getRequest() != null) {
                allItems.add(item);
            }
        }

        return allItems;
    }

    /**
     * Sanitize filename by removing invalid characters
     */
    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) {
            return "unnamed_request";
        }

        String sanitized = name.replaceAll("[<>:\"/\\\\|?*]", "_");
        sanitized = sanitized.replaceAll("\\s+", "_");
        sanitized = sanitized.replaceAll("^[_\\s]+|[_\\s]+$", "");

        if (sanitized.isEmpty()) {
            return "unnamed_request";
        }

        if (sanitized.length() > 200) {
            sanitized = sanitized.substring(0, 200);
        }

        return sanitized;
    }
}
