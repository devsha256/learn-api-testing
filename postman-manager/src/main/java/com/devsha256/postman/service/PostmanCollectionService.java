package com.devsha256.postman.service;

import com.devsha256.postman.model.PostmanCollection;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Service class for managing Postman collections
 * Provides functionality to split and merge collections
 */
@Service
public class PostmanCollectionService {

    private static final Logger log = LoggerFactory.getLogger(PostmanCollectionService.class);

    private final ObjectMapper objectMapper;

    public PostmanCollectionService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    /**
     * Feature 1: Split a single collection into individual collections per request
     * Collection name is based on the request name (normalized for file system)
     *
     * @param sourceFilePath Path to the source Postman collection JSON file
     * @param outputDir Directory where individual collections will be created
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

        // Create individual collection for each request
        int count = 0;
        for (PostmanCollection.Item item : allItems) {
            if (item.getRequest() != null) { // Only process actual requests, not folders
                // REQUIREMENT 1: Collection name is based on request name
                PostmanCollection newCollection = createCollectionFromItem(item, sourceCollection, item.getName());

                // Normalize filename (already done in sanitizeFileName method)
                String fileName = sanitizeFileName(item.getName()) + ".json";
                String outputPath = outputDir + File.separator + fileName;

                objectMapper.writerWithDefaultPrettyPrinter()
                        .writeValue(new File(outputPath), newCollection);

                count++;
                log.info("Created collection {}/{}: {} -> {}", count, allItems.size(), item.getName(), fileName);
            }
        }

        log.info("Successfully created {} individual collections in: {}", count, outputDir);
    }

    /**
     * Feature 2: Merge multiple collections from a folder into one
     * Collection name is taken from the output file name (without .json extension)
     * No folders - all requests are flattened into a single level
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

        // REQUIREMENT 2: Extract collection name from output file (without .json extension)
        String collectionName = extractCollectionNameFromFilePath(outputFilePath);

        // Create merged collection
        PostmanCollection mergedCollection = new PostmanCollection();
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(collectionName);  // Use name from file path
        info.setDescription("Merged collection containing all requests from: " + sourceFolderPath);
        info.setSchema("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
        mergedCollection.setInfo(info);
        mergedCollection.setItem(new ArrayList<>());
        mergedCollection.setVariable(new ArrayList<>());

        // Find all JSON files in the folder
        try (Stream<Path> paths = Files.walk(Paths.get(sourceFolderPath))) {
            List<Path> jsonFiles = paths
                    .filter(Files::isRegularFile)
                    .filter(p -> p.toString().endsWith(".json"))
                    .toList();

            log.info("Found {} JSON files to merge", jsonFiles.size());

            if (jsonFiles.isEmpty()) {
                log.warn("No JSON files found in the source folder");
                throw new IOException("No JSON files found in folder: " + sourceFolderPath);
            }

            int successCount = 0;
            for (Path jsonFile : jsonFiles) {
                try {
                    PostmanCollection collection = objectMapper.readValue(jsonFile.toFile(), PostmanCollection.class);

                    // REQUIREMENT 2: No folders - flatten all requests to single level
                    List<PostmanCollection.Item> allRequests = extractAllItems(collection.getItem());

                    // Add all requests directly to merged collection (no folder structure)
                    for (PostmanCollection.Item request : allRequests) {
                        if (request.getRequest() != null) {
                            mergedCollection.getItem().add(request);
                        }
                    }

                    // Merge variables (avoiding duplicates)
                    mergeVariables(mergedCollection, collection);

                    successCount++;
                    log.info("Merged collection {}/{}: {} ({} requests)",
                            successCount, jsonFiles.size(),
                            collection.getInfo().getName(),
                            allRequests.size());
                } catch (Exception e) {
                    log.error("Failed to process file: {}. Error: {}", jsonFile.getFileName(), e.getMessage());
                }
            }

            if (successCount == 0) {
                throw new IOException("Failed to merge any collections. Check if files are valid Postman collections.");
            }
        }

        // Create output directory if it doesn't exist
        File outputFile = new File(outputFilePath);
        if (outputFile.getParentFile() != null) {
            Files.createDirectories(outputFile.getParentFile().toPath());
        }

        // Write merged collection to output file
        objectMapper.writerWithDefaultPrettyPrinter()
                .writeValue(outputFile, mergedCollection);

        log.info("Successfully merged {} requests into collection '{}': {}",
                mergedCollection.getItem().size(), collectionName, outputFilePath);
    }

    /**
     * Extract collection name from output file path (without .json extension)
     *
     * @param filePath Output file path
     * @return Collection name without extension
     */
    private String extractCollectionNameFromFilePath(String filePath) {
        File file = new File(filePath);
        String fileName = file.getName();

        // Remove .json extension if present
        if (fileName.toLowerCase().endsWith(".json")) {
            fileName = fileName.substring(0, fileName.length() - 5);
        }

        // If empty after removing extension, use default
        if (fileName.trim().isEmpty()) {
            return "Merged Collection";
        }

        return fileName;
    }

    /**
     * Recursively extract all items from nested folders
     *
     * @param items List of collection items (may include folders)
     * @return Flat list of all request items
     */
    private List<PostmanCollection.Item> extractAllItems(List<PostmanCollection.Item> items) {
        List<PostmanCollection.Item> allItems = new ArrayList<>();

        if (items == null) {
            return allItems;
        }

        for (PostmanCollection.Item item : items) {
            if (item.getItem() != null && !item.getItem().isEmpty()) {
                // This is a folder, recurse into it
                allItems.addAll(extractAllItems(item.getItem()));
            } else if (item.getRequest() != null) {
                // This is a request
                allItems.add(item);
            }
        }

        return allItems;
    }

    /**
     * Create a new collection containing a single request item
     * Collection name is set to the provided name (usually the request name)
     *
     * @param item The request item to create a collection from
     * @param sourceCollection The original collection (for metadata)
     * @param collectionName The name for the new collection
     * @return New collection with single request
     */
    private PostmanCollection createCollectionFromItem(PostmanCollection.Item item,
                                                       PostmanCollection sourceCollection,
                                                       String collectionName) {
        PostmanCollection newCollection = new PostmanCollection();

        // Copy info with new ID and name based on request name
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(collectionName);  // Use the provided collection name
        info.setDescription(item.getDescription());
        info.setSchema(sourceCollection.getInfo().getSchema());
        newCollection.setInfo(info);

        // Add the single item
        List<PostmanCollection.Item> items = new ArrayList<>();
        items.add(item);
        newCollection.setItem(items);

        // Copy variables and auth from source
        newCollection.setVariable(new ArrayList<>(sourceCollection.getVariable()));
        newCollection.setAuth(sourceCollection.getAuth());

        return newCollection;
    }

    /**
     * Merge variables from source to target, avoiding duplicates
     *
     * @param target Target collection to merge variables into
     * @param source Source collection to merge variables from
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

    /**
     * Sanitize filename by removing invalid characters
     * Normalizes the name to be file-system safe
     *
     * @param name Original filename
     * @return Sanitized filename safe for file systems
     */
    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) {
            return "unnamed_request";
        }

        // Replace invalid filename characters with underscore
        // Invalid chars: < > : " / \ | ? *
        String sanitized = name.replaceAll("[<>:\"/\\\\|?*]", "_");

        // Replace multiple spaces with single underscore
        sanitized = sanitized.replaceAll("\\s+", "_");

        // Remove leading/trailing underscores and spaces
        sanitized = sanitized.replaceAll("^[_\\s]+|[_\\s]+$", "");

        // If empty after sanitization, use default
        if (sanitized.isEmpty()) {
            return "unnamed_request";
        }

        // Limit length to 200 characters (leave room for .json extension)
        if (sanitized.length() > 200) {
            sanitized = sanitized.substring(0, 200);
        }

        return sanitized;
    }
}
