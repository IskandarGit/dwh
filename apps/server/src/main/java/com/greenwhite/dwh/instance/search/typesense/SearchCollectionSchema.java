package com.greenwhite.dwh.instance.search.typesense;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Typesense 27.1 fields. MIXED preserves the default tokenizer and disables stemming. */
public final class SearchCollectionSchema {
    private SearchCollectionSchema() {}

    public static Map<String,Object> mixed(String collection, String entityType) {
        return forProfile(collection, entityType, "MIXED");
    }

    public static Map<String,Object> forProfile(String collection, String entityType, String profile) {
        if (!List.of("MIXED", "RU").contains(profile)) throw new IllegalArgumentException("Unknown schema profile");
        List<Map<String,Object>> fields = new ArrayList<>();
        switch (entityType) {
            case "TASK" -> {
                fields.add(number("task_id", false));
                fields.add(text("title", false));
                fields.add(text("description_markdown", true));
                fields.add(text("status_name", true));
                fields.add(text("priority", true));
                fields.add(number("project_id", true));
                fields.add(text("project_name", true));
            }
            case "PROJECT" -> {
                fields.add(number("project_id", false));
                fields.add(text("name", false));
                fields.add(text("description", true));
                fields.add(Map.of("name", "state", "type", "string", "facet", true));
            }
            case "USER" -> {
                fields.add(number("user_id", false));
                fields.add(text("name", false));
                fields.add(text("login", false));
                fields.add(text("email", false));
                fields.add(text("phone", true));
                fields.add(Map.of("name", "state", "type", "string", "facet", true));
            }
            case "NOTE" -> {
                fields.add(number("note_id", false));
                fields.add(text("title", false));
                fields.add(text("content_md", true));
                fields.add(text("color", true));
                fields.add(Map.of("name", "is_pinned", "type", "bool", "optional", true));
            }
            default -> throw new IllegalArgumentException("Unknown projection type");
        }
        fields.add(Map.of("name", "_projection_revision", "type", "int64", "index", false, "sort", false));
        fields.add(Map.of("name", "_projection_fingerprint", "type", "string", "index", false));
        if ("RU".equals(profile)) {
            List<String> naturalLanguage = switch (entityType) {
                case "TASK" -> List.of("title", "description_markdown", "status_name", "project_name");
                case "PROJECT" -> List.of("name", "description");
                case "NOTE" -> List.of("title", "content_md");
                default -> List.of("name");
            };
            fields.replaceAll(field -> {
                if (!naturalLanguage.contains(field.get("name"))) return field;
                var localized = new java.util.LinkedHashMap<String,Object>(field);
                localized.put("locale", "ru");
                localized.put("stem", true);
                return Map.copyOf(localized);
            });
        }
        return Map.of("name", collection, "fields", List.copyOf(fields));
    }

    private static Map<String,Object> text(String name, boolean optional) {
        return Map.of("name", name, "type", "string", "optional", optional, "stem", false);
    }
    private static Map<String,Object> number(String name, boolean optional) {
        return Map.of("name", name, "type", "int64", "optional", optional);
    }
}
