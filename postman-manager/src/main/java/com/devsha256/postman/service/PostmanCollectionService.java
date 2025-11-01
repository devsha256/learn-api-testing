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
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Service class for managing Postman collections using Functional Programming paradigm
 * Leverages Java Streams, Lambdas, and Functional Interfaces
 */
@Service
public class PostmanCollectionService {

    private static final Logger log = LoggerFactory.getLogger(PostmanCollectionService.class);

    private final ObjectMapper objectMapper;

    // Resource patterns to extract
    private static final String REST_PATTERN = "/ws/rest";
    private static final String SOAP_PATTERN = "/ws/soap";

    // Predicates for filtering
    private static final Predicate<PostmanCollection.Item> HAS_REQUEST =
            item -> item.getRequest() != null;

    private static final Predicate<PostmanCollection.Item> IS_FOLDER =
            item -> item.getItem() != null && !item.getItem().isEmpty();

    private static final Predicate<Path> IS_JSON_FILE =
            path -> Files.isRegularFile(path) && path.toString().endsWith(".json");

    public PostmanCollectionService() {
        this.objectMapper = new ObjectMapper();
        this.objectMapper.enable(SerializationFeature.INDENT_OUTPUT);
    }

    /**
     * Feature 1: Split collection by grouping requests with same method+resource across environments
     */
    public void splitCollectionIntoIndividualRequests(String sourceFilePath, String outputDir) throws IOException {
        log.info("Reading source collection from: {}", sourceFilePath);

        // Validate and read source collection
        PostmanCollection sourceCollection = readCollectionFile(sourceFilePath);

        // Create output directory
        Files.createDirectories(Paths.get(outputDir));

        // Extract, group, and create collections using functional approach
        List<PostmanCollection.Item> allRequests = extractAllItems(sourceCollection.getItem());

        log.info("Found {} requests in the collection", allRequests.size());

        Map<String, List<PostmanCollection.Item>> groupedRequests = allRequests.stream()
                .filter(HAS_REQUEST)
                .collect(Collectors.groupingBy(
                        this::createGroupKeyForSplit,
                        LinkedHashMap::new,
                        Collectors.toList()
                ));

        log.info("Grouped into {} unique resources", groupedRequests.size());

        // Create and save collections
        groupedRequests.entrySet().stream()
                .peek(entry -> log.info("Creating collection: {} ({} requests)",
                        entry.getKey(), entry.getValue().size()))
                .forEach(entry -> saveGroupedCollection(
                        entry.getKey(),
                        entry.getValue(),
                        sourceCollection,
                        outputDir
                ));

        log.info("Successfully created {} grouped collections in: {}", groupedRequests.size(), outputDir);
    }

    /**
     * Feature 2: Merge collections by grouping requests with same resource into folders
     */
    public void mergeCollectionsFromFolder(String sourceFolderPath, String outputFilePath) throws IOException {
        log.info("Reading collections from folder: {}", sourceFolderPath);

        validateDirectory(sourceFolderPath);

        String collectionName = extractCollectionNameFromFilePath(outputFilePath);

        // Load all collections and extract requests using functional approach
        try (Stream<Path> paths = Files.walk(Paths.get(sourceFolderPath))) {

            List<Path> jsonFiles = paths.filter(IS_JSON_FILE).toList();

            log.info("Found {} JSON files to merge", jsonFiles.size());

            if (jsonFiles.isEmpty()) {
                throw new IOException("No JSON files found in folder: " + sourceFolderPath);
            }

            // Load all requests and variables
            LoadedData loadedData = jsonFiles.stream()
                    .map(this::tryLoadCollection)
                    .filter(Optional::isPresent)
                    .map(Optional::get)
                    .reduce(new LoadedData(), this::accumulate, this::combine);

            log.info("Loaded {} total requests from {} collections",
                    loadedData.requests.size(), jsonFiles.size());

            // Group and rename requests
            Map<String, List<PostmanCollection.Item>> groupedRequests =
                    groupAndRenameRequestsForMerge(loadedData.requests);

            log.info("Grouped {} requests into {} resource folders",
                    loadedData.requests.size(), groupedRequests.size());

            // Create and save merged collection
            PostmanCollection mergedCollection = createMergedCollection(
                    collectionName, groupedRequests, loadedData.variables);

            saveMergedCollection(mergedCollection, outputFilePath);

            log.info("Successfully merged into collection '{}' with {} folders: {}",
                    collectionName, groupedRequests.size(), outputFilePath);
        }
    }

    /**
     * Create group key for SPLIT operation
     */
    private String createGroupKeyForSplit(PostmanCollection.Item item) {
        return extractUrlFromRequest(item)
                .map(url -> {
                    String method = extractMethod(item);
                    String resource = extractNormalizedResourceForSplit(url);
                    return method + " " + resource;
                })
                .orElseGet(() -> "UNKNOWN " + sanitizeFileName(item.getName()));
    }

    /**
     * Group and rename requests for MERGE operation
     */
    private Map<String, List<PostmanCollection.Item>> groupAndRenameRequestsForMerge(
            List<PostmanCollection.Item> requests) {

        return requests.stream()
                .filter(HAS_REQUEST)
                .map(this::enrichItemWithHostName)
                .filter(Optional::isPresent)
                .map(Optional::get)
                .collect(Collectors.groupingBy(
                        EnrichedItem::resourceGroup,
                        LinkedHashMap::new,
                        Collectors.mapping(EnrichedItem::item, Collectors.toList())
                ));
    }

    /**
     * Enrich item with host name and resource group
     */
    private Optional<EnrichedItem> enrichItemWithHostName(PostmanCollection.Item item) {
        return extractUrlFromRequest(item)
                .map(url -> {
                    String resourceGroup = extractResourceGroup(url);
                    String host = extractHost(url);

                    // Rename the item
                    item.setName(host);

                    log.debug("Grouped to '{}', renamed to '{}'", resourceGroup, host);

                    return new EnrichedItem(resourceGroup, item);
                });
    }

    /**
     * Extract all items recursively using Stream flatMap
     */
    private List<PostmanCollection.Item> extractAllItems(List<PostmanCollection.Item> items) {
        return Optional.ofNullable(items)
                .orElse(Collections.emptyList())
                .stream()
                .flatMap(this::flattenItem)
                .toList();
    }

    /**
     * Flatten item recursively
     */
    private Stream<PostmanCollection.Item> flattenItem(PostmanCollection.Item item) {
        if (IS_FOLDER.test(item)) {
            return item.getItem().stream().flatMap(this::flattenItem);
        } else if (HAS_REQUEST.test(item)) {
            return Stream.of(item);
        }
        return Stream.empty();
    }

    /**
     * Extract URL from request using Optional
     */
    private Optional<String> extractUrlFromRequest(PostmanCollection.Item item) {
        return Optional.ofNullable(item.getRequest())
                .filter(Map.class::isInstance)
                .map(req -> (Map<String, Object>) req)
                .map(req -> req.get("url"))
                .map(this::extractUrlString)
                .filter(url -> !url.isEmpty());
    }
    
    /**
     * Extract URL string from various formats
     */
    private String extractUrlString(Object urlObj) {
        if (urlObj == null) {
            return "";
        }

        if (urlObj instanceof String stringUrl) {
            return stringUrl;
        }

        if (urlObj instanceof Map<?, ?> urlMap) {
            // Try raw and href fields using Stream
            return Stream.of("raw", "href")
                    .map(urlMap::get)
                    .filter(Objects::nonNull)
                    .map(Object::toString)
                    .findFirst()
                    .orElse("");
        }

        return urlObj.toString();
    }


    /**
     * Extract URL string from map structure
     */
    private String extractFromUrlMap(Map<?, ?> urlMap) {
        Object raw = urlMap.get("raw");
        if (raw != null) {
            return raw.toString();
        }

        Object href = urlMap.get("href");
        if (href != null) {
            return href.toString();
        }

        return "";
    }


    /**
     * Extract HTTP method using Optional
     */
    private String extractMethod(PostmanCollection.Item item) {
        return Optional.ofNullable(item.getRequest())
                .filter(Map.class::isInstance)
                .map(req -> (Map<String, Object>) req)
                .map(req -> req.get("method"))
                .map(Object::toString)
                .map(String::toUpperCase)
                .orElse("GET");
    }

    /**
     * Extract normalized resource for SPLIT (includes /ws/rest or /ws/soap)
     */
    private String extractNormalizedResourceForSplit(String urlString) {
        return Stream.of(REST_PATTERN, SOAP_PATTERN)
                .map(pattern -> extractFromPattern(urlString, pattern, true))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .findFirst()
                .orElseGet(() -> extractPathFallback(urlString));
    }

    /**
     * Extract resource group for MERGE (excludes /ws/rest or /ws/soap)
     */
    private String extractResourceGroup(String urlString) {
        return Stream.of(REST_PATTERN, SOAP_PATTERN)
                .map(pattern -> extractFromPattern(urlString, pattern, false))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .findFirst()
                .orElseGet(() -> extractPathFallback(urlString));
    }

    /**
     * Extract resource from URL based on pattern
     * @param includePattern if true, includes the pattern in result (for SPLIT)
     *                       if false, excludes the pattern (for MERGE)
     */
    private Optional<String> extractFromPattern(String urlString, String pattern, boolean includePattern) {
        int index = urlString.indexOf(pattern);
        if (index != -1) {
            int startIndex = includePattern ? index : index + pattern.length();
            String resource = urlString.substring(startIndex);
            return Optional.of(removeQueryParams(resource));
        }
        return Optional.empty();
    }

    /**
     * Extract host from URL using Optional and URI
     */
    private String extractHost(String urlString) {
        return tryParseUri(urlString)
                .map(uri -> {
                    String host = uri.getHost();
                    int port = uri.getPort();

                    if (host == null) {
                        return "unknown-host";
                    }

                    // Include port if non-standard
                    return (port != -1 && port != 80 && port != 443)
                            ? host + ":" + port
                            : host;
                })
                .orElse("unknown-host");
    }

    /**
     * Fallback path extraction using URI
     */
    private String extractPathFallback(String urlString) {
        return tryParseUri(urlString)
                .map(URI::getPath)
                .map(this::removeQueryParams)
                .filter(path -> !path.isEmpty())
                .orElse("/unknown");
    }

    /**
     * Try to parse URI, return Optional
     */
    private Optional<URI> tryParseUri(String urlString) {
        try {
            return Optional.of(new URI(urlString));
        } catch (URISyntaxException e) {
            log.debug("Could not parse URI: {}", urlString);
            return Optional.empty();
        }
    }

    /**
     * Remove query parameters and fragments
     */
    private String removeQueryParams(String str) {
        return Optional.ofNullable(str)
                .map(s -> s.split("[?#]")[0])
                .orElse("");
    }

    /**
     * Read collection file with error handling
     */
    private PostmanCollection readCollectionFile(String filePath) throws IOException {
        File file = new File(filePath);
        if (!file.exists()) {
            throw new IOException("Source file not found: " + filePath);
        }
        return objectMapper.readValue(file, PostmanCollection.class);
    }

    /**
     * Validate directory exists
     */
    private void validateDirectory(String dirPath) throws IOException {
        File dir = new File(dirPath);
        if (!dir.exists() || !dir.isDirectory()) {
            throw new IOException("Source folder not found or is not a directory: " + dirPath);
        }
    }

    /**
     * Try to load collection, return Optional
     */
    private Optional<PostmanCollection> tryLoadCollection(Path path) {
        try {
            PostmanCollection collection = objectMapper.readValue(path.toFile(), PostmanCollection.class);
            log.info("Loaded collection: {} ({} items)",
                    collection.getInfo().getName(),
                    Optional.ofNullable(collection.getItem()).map(List::size).orElse(0));
            return Optional.of(collection);
        } catch (Exception e) {
            log.error("Failed to process file: {}. Error: {}", path.getFileName(), e.getMessage());
            return Optional.empty();
        }
    }

    /**
     * Accumulate loaded data
     */
    private LoadedData accumulate(LoadedData accumulated, PostmanCollection collection) {
        // Add all requests
        accumulated.requests.addAll(extractAllItems(collection.getItem()));

        // Merge variables
        Optional.ofNullable(collection.getVariable())
                .orElse(Collections.emptyList())
                .stream()
                .filter(var -> accumulated.variables.stream()
                        .noneMatch(existing -> existing.getKey().equals(var.getKey())))
                .forEach(accumulated.variables::add);

        return accumulated;
    }

    /**
     * Combine two LoadedData instances
     */
    private LoadedData combine(LoadedData data1, LoadedData data2) {
        data1.requests.addAll(data2.requests);

        data2.variables.stream()
                .filter(var -> data1.variables.stream()
                        .noneMatch(existing -> existing.getKey().equals(var.getKey())))
                .forEach(data1.variables::add);

        return data1;
    }

    /**
     * Save grouped collection for SPLIT operation
     */
    private void saveGroupedCollection(String groupKey,
                                       List<PostmanCollection.Item> requests,
                                       PostmanCollection sourceCollection,
                                       String outputDir) {
        try {
            PostmanCollection newCollection = createGroupedCollection(requests, sourceCollection, groupKey);

            String fileName = sanitizeFileName(groupKey) + ".json";
            Path outputPath = Paths.get(outputDir, fileName);

            objectMapper.writerWithDefaultPrettyPrinter()
                    .writeValue(outputPath.toFile(), newCollection);

            log.info("Created collection: {}", fileName);
        } catch (IOException e) {
            log.error("Failed to save collection '{}': {}", groupKey, e.getMessage());
        }
    }

    /**
     * Create grouped collection
     */
    private PostmanCollection createGroupedCollection(List<PostmanCollection.Item> requests,
                                                      PostmanCollection sourceCollection,
                                                      String groupKey) {
        PostmanCollection newCollection = new PostmanCollection();

        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(groupKey);
        info.setDescription("Collection for " + groupKey + " across all environments");
        info.setSchema(sourceCollection.getInfo().getSchema());
        newCollection.setInfo(info);

        newCollection.setItem(new ArrayList<>(requests));
        newCollection.setVariable(Optional.ofNullable(sourceCollection.getVariable())
                .map(ArrayList::new)
                .orElse(new ArrayList<>()));
        newCollection.setAuth(sourceCollection.getAuth());

        return newCollection;
    }

    /**
     * Create merged collection with folders
     */
    private PostmanCollection createMergedCollection(String collectionName,
                                                     Map<String, List<PostmanCollection.Item>> groupedRequests,
                                                     List<PostmanCollection.Variable> variables) {
        PostmanCollection mergedCollection = new PostmanCollection();

        PostmanCollection.Info info = new PostmanCollection.Info();
        info.setPostmanId(UUID.randomUUID().toString());
        info.setName(collectionName);
        info.setDescription("Merged collection with " + groupedRequests.size() + " resource groups");
        info.setSchema("https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
        mergedCollection.setInfo(info);

        List<PostmanCollection.Item> folders = groupedRequests.entrySet().stream()
                .map(entry -> createFolder(entry.getKey(), entry.getValue()))
                .peek(folder -> log.debug("Created folder '{}' with {} requests",
                        folder.getName(), folder.getItem().size()))
                .toList();

        mergedCollection.setItem(new ArrayList<>(folders));
        mergedCollection.setVariable(variables);

        return mergedCollection;
    }

    /**
     * Create folder item
     */
    private PostmanCollection.Item createFolder(String resourceGroup, List<PostmanCollection.Item> requests) {
        PostmanCollection.Item folder = new PostmanCollection.Item();
        folder.setName(resourceGroup);
        folder.setDescription("Resource: " + resourceGroup + " (" + requests.size() + " environments)");
        folder.setItem(new ArrayList<>(requests));
        return folder;
    }

    /**
     * Save merged collection
     */
    private void saveMergedCollection(PostmanCollection collection, String outputFilePath) throws IOException {
        File outputFile = new File(outputFilePath);

        Optional.ofNullable(outputFile.getParentFile())
                .ifPresent(parent -> {
                    try {
                        Files.createDirectories(parent.toPath());
                    } catch (IOException e) {
                        log.error("Failed to create output directory: {}", e.getMessage());
                    }
                });

        objectMapper.writerWithDefaultPrettyPrinter()
                .writeValue(outputFile, collection);
    }

    /**
     * Extract collection name from file path
     */
    private String extractCollectionNameFromFilePath(String filePath) {
        return Optional.of(new File(filePath))
                .map(File::getName)
                .map(name -> name.toLowerCase().endsWith(".json")
                        ? name.substring(0, name.length() - 5)
                        : name)
                .filter(name -> !name.trim().isEmpty())
                .orElse("Merged Collection");
    }

    /**
     * Sanitize filename
     */
    private String sanitizeFileName(String name) {
        return Optional.ofNullable(name)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> s.replaceAll("[<>:\"/\\\\|?*]", "_"))
                .map(s -> s.replaceAll("\\s+", "_"))
                .map(s -> s.replaceAll("^[_\\s]+|[_\\s]+$", ""))
                .map(s -> s.length() > 200 ? s.substring(0, 200) : s)
                .filter(s -> !s.isEmpty())
                .orElse("unnamed_request");
    }

    // Helper records for functional composition

    /**
     * Container for loaded collection data
     */
    private static class LoadedData {
        final List<PostmanCollection.Item> requests = new ArrayList<>();
        final List<PostmanCollection.Variable> variables = new ArrayList<>();
    }

    /**
     * Record for enriched item with resource group
     */
    private record EnrichedItem(String resourceGroup, PostmanCollection.Item item) {}
}
