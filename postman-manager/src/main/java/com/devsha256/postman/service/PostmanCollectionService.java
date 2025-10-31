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
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Service class for managing Postman collections
 * Provides functionality to split and merge collections with environment grouping
 */
@Service
public class PostmanCollectionService {

    private static final Logger log = LoggerFactory.getLogger(PostmanCollectionService.class);

    private final ObjectMapper objectMapper;

    // Known environment patterns for Mule and Boomi
    private static final List<String> MULE_ENVIRONMENTS = Arrays.asList("-dev", "-qa", "-uat", "-prod");
    private static final String BOOMI_PATTERN = "boomi";

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
     * Requests targeting the same resource across different environments are grouped together
     *
     * Example:
     *   GET https://mule-dev.com/test-app-dev/ws/rest/GetCustomer
     *   GET https://mule-qa.com/test-app-qa/ws/rest/GetCustomer
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
                // Extract method and normalized resource
                String method = extractMethod(item);
                String normalizedResource = extractNormalizedResource(item);

                // Create group key: "METHOD /resource/path"
                String groupKey = method + " " + normalizedResource;

                // Add to group
                grouped.computeIfAbsent(groupKey, k -> new ArrayList<>()).add(item);

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
     * Removes environment-specific parts (host, app name) to get the core resource path
     *
     * Examples:
     *   https://mule-dev.com/test-app-dev/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     *   https://mule-qa.com/test-app-qa/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     *   https://boomi-pp.com/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     */
    private String extractNormalizedResource(PostmanCollection.Item item) throws URISyntaxException {
        try {
            Map<String, Object> request = (Map<String, Object>) item.getRequest();
            Object urlObj = request.get("url");

            String urlString = extractUrlString(urlObj);

            if (urlString == null || urlString.isEmpty()) {
                return "/" + sanitizeFileName(item.getName());
            }

            // Parse URL
            URI uri = new URI(urlString);
            String path = uri.getPath();

            if (path == null || path.isEmpty()) {
                return "/" + sanitizeFileName(item.getName());
            }

            // Remove Mule app name pattern (e.g., /test-app-dev/, /test-app-qa/)
            path = removeMuleAppName(path);

            return path;

        } catch (Exception e) {
            log.debug("Could not extract resource from request '{}': {}", item.getName(), e.getMessage());
            return "/" + sanitizeFileName(item.getName());
        }
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
        }

        return urlObj.toString();
    }

    /**
     * Remove Mule app name from path
     * Pattern: /app-name-env/rest/of/path -> /rest/of/path
     *
     * Examples:
     *   /test-app-dev/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     *   /test-app-qa/ws/rest/GetCustomer -> /ws/rest/GetCustomer
     */
    private String removeMuleAppName(String path) {
        if (path == null || path.isEmpty()) {
            return path;
        }

        // Split path into segments
        String[] segments = path.split("/");

        if (segments.length < 2) {
            return path;
        }

        // Check if first segment (after leading /) looks like a Mule app name
        // Pattern: app-name-env (contains environment suffix)
        String firstSegment = segments[1];

        for (String env : MULE_ENVIRONMENTS) {
            if (firstSegment.endsWith(env)) {
                // Remove first segment and reconstruct path
                return "/" + String.join("/", Arrays.copyOfRange(segments, 2, segments.length));
            }
        }

        return path;
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
        newCollection.setVariable(new ArrayList<>(sourceCollection.getVariable()));
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
            folder.setDescription("Requests for " + groupKey + " across environments");
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

    /**
     * Merge variables from source to target, avoiding duplicates
     */
    private void mergeVariables(PostmanCollection target, PostmanCollection source) {
        if (source.getVariable() == null || source.getVariable().isEmpty()) {
            return;
        }

        for (PostmanCollection.Variable sourceVar : source.getVariable()) {
            boolean exists = target.getVariable().stream()
                    .anyMatch(v -> v.getKey().equals(sourceVar.getKey()));

            if (!exists) {
                target.getVariable().add(sourceVar);
            }
        }
    }
}
