package com.devsha256.postman.service;

import com.devsha256.postman.model.PostmanCollection;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.extern.slf4j.Slf4j;
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
@Slf4j
public class PostmanCollectionService {

    private final ObjectMapper objectMapper;

    public PostmanCollectionService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    /**
     * Feature 1: Split a single collection into individual collections per request
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
                PostmanCollection newCollection = createCollectionFromItem(item, sourceCollection);
                String fileName = sanitizeFileName(item.getName()) + ".json";
                String outputPath = outputDir + File.separator + fileName;

                objectMapper.writerWithDefaultPrettyPrinter()
                        .writeValue(new File(outputPath), newCollection);

                count++;
                log.info("Created collection {}/{}: {}", count, allItems.size(), fileName);
            }
        }

        log.info("Successfully created {} individual collections in: {}", count, outputDir);
    }

    /**
     * Feature 2: Merge multiple collections from a folder into one
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

        // Create merged collection
        PostmanCollection mergedCollection = new PostmanCollection();
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName("Merged Collection - " + sourceFolder.getName());
        info.setDescription("Combined collection from multiple sources in folder: " + sourceFolderPath);
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

                    // Create a folder for this collection's items
                    PostmanCollection.Item folder = new PostmanCollection.Item();
                    folder.setName(collection.getInfo().getName());
                    folder.setDescription(collection.getInfo().getDescription());
                    folder.setItem(new ArrayList<>(collection.getItem()));

                    mergedCollection.getItem().add(folder);

                    // Merge variables (avoiding duplicates)
                    mergeVariables(mergedCollection, collection);

                    successCount++;
                    log.info("Merged collection {}/{}: {}", successCount, jsonFiles.size(),
                            collection.getInfo().getName());
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

        log.info("Successfully merged collections into: {}", outputFilePath);
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
     *
     * @param item The request item to create a collection from
     * @param sourceCollection The original collection (for metadata)
     * @return New collection with single request
     */
    private PostmanCollection createCollectionFromItem(PostmanCollection.Item item,
                                                       PostmanCollection sourceCollection) {
        PostmanCollection newCollection = new PostmanCollection();

        // Copy info with new ID and name
        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(item.getName());
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
     *
     * @param name Original filename
     * @return Sanitized filename safe for file systems
     */
    private String sanitizeFileName(String name) {
        if (name == null || name.trim().isEmpty()) {
            return "unnamed_request";
        }
        return name.replaceAll("[^a-zA-Z0-9.\\-_ ]", "_")
                .replaceAll("\\s+", "_")
                .trim();
    }
}
