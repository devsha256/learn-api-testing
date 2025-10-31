package com.devsha256.postman.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import java.util.ArrayList;
import java.util.List;

/**
 * Model class representing a Postman Collection v2.1 format
 * This class maps to the JSON structure of Postman collections
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class PostmanCollection {

    @JsonProperty("info")
    private Info info;

    @JsonProperty("item")
    private List<Item> item = new ArrayList<>();

    @JsonProperty("variable")
    private List<Variable> variable = new ArrayList<>();

    @JsonProperty("auth")
    private Object auth;

    @JsonProperty("event")
    private List<Event> event = new ArrayList<>();

    /**
     * Collection metadata information
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Info {
        @JsonProperty("_postman_id")
        private String postmanId;

        @JsonProperty("name")
        private String name;

        @JsonProperty("description")
        private String description;

        @JsonProperty("schema")
        private String schema;

        @JsonProperty("version")
        private String version;
    }

    /**
     * Collection item - can be either a request or a folder containing other items
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Item {
        @JsonProperty("name")
        private String name;

        @JsonProperty("item")
        private List<Item> item;

        @JsonProperty("request")
        private Object request;

        @JsonProperty("response")
        private List<Object> response = new ArrayList<>();

        @JsonProperty("event")
        private List<Event> event = new ArrayList<>();

        @JsonProperty("description")
        private String description;

        @JsonProperty("protocolProfileBehavior")
        private Object protocolProfileBehavior;
    }

    /**
     * Collection-level or environment variable
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Variable {
        @JsonProperty("key")
        private String key;

        @JsonProperty("value")
        private String value;

        @JsonProperty("type")
        private String type;

        @JsonProperty("description")
        private String description;
    }

    /**
     * Event scripts (pre-request or test scripts)
     */
    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Event {
        @JsonProperty("listen")
        private String listen;

        @JsonProperty("script")
        private Object script;
    }
}
