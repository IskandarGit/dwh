package com.greenwhite.dwh.instance.config.openapi;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiControllerTest {

    @Test
    @DisplayName("OpenAPI spec returns valid 3.1.0 specification with SmartupCMS Core API branding")
    @SuppressWarnings("unchecked")
    void shouldReturnValidOpenApiSpecification() {
        var controller = new OpenApiController();
        var response = controller.getOpenApiSpec();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Map<String, Object> spec = response.getBody();
        assertThat(spec).isNotNull();

        // 1. OpenAPI metadata
        assertThat(spec.get("openapi")).isEqualTo("3.1.0");
        Map<String, Object> info = (Map<String, Object>) spec.get("info");
        assertThat(info).isNotNull();
        assertThat(info.get("title")).isEqualTo("SmartupCMS Core API");
        assertThat(info.get("version")).isEqualTo("2.0.0");

        // 2. Components & Security
        Map<String, Object> components = (Map<String, Object>) spec.get("components");
        assertThat(components).isNotNull();
        Map<String, Object> securitySchemes = (Map<String, Object>) components.get("securitySchemes");
        assertThat(securitySchemes).isNotNull();

        Map<String, Object> bearerAuth = (Map<String, Object>) securitySchemes.get("BearerAuth");
        assertThat(bearerAuth).isNotNull();
        assertThat(bearerAuth.get("type")).isEqualTo("http");
        assertThat(bearerAuth.get("scheme")).isEqualTo("bearer");
        assertThat((String) bearerAuth.get("description")).contains("dwh_");

        Map<String, Object> sessionCookie = (Map<String, Object>) securitySchemes.get("SessionCookie");
        assertThat(sessionCookie).isNotNull();
        assertThat(sessionCookie.get("name")).isEqualTo("DWH_SESSION");

        Map<String, Object> schemas = (Map<String, Object>) components.get("schemas");
        assertThat(schemas).containsKey("ProblemDetail");
        assertThat(schemas).containsKey("TaskItem");

        // 3. Paths coverage
        Map<String, Object> paths = (Map<String, Object>) spec.get("paths");
        assertThat(paths).isNotNull();

        // Must include all core domain paths
        List<String> expectedPaths = List.of(
                "/api/v1/auth/login",
                "/api/v1/auth/me",
                "/api/v1/auth/logout",
                "/api/v1/tasks/items",
                "/api/v1/tasks/items/{id}",
                "/api/v1/tasks/items/{id}/status",
                "/api/v1/files/upload",
                "/api/v1/files/{id}/download",
                "/api/v1/audit/logs",
                "/api/v1/audit/security-events",
                "/api/v1/audit/stats",
                "/api/v1/reports/tasks-export-csv",
                "/api/v1/reports/tasks-export-xml",
                "/api/v1/search",
                "/api/v1/search/management/status",
                "/api/v1/notes",
                "/api/v1/settings",
                "/api/v1/modules",
                "/api/v1/system/info"
        );

        for (String expectedPath : expectedPaths) {
            assertThat(paths).as("OpenAPI spec must contain path: " + expectedPath).containsKey(expectedPath);
        }

        // Verify OCC and Rate-limit response documentation
        Map<String, Object> taskPatch = (Map<String, Object>) ((Map<String, Object>) paths.get("/api/v1/tasks/items/{id}")).get("patch");
        Map<String, Object> patchResponses = (Map<String, Object>) taskPatch.get("responses");
        assertThat(patchResponses).containsKey("409");

        Map<String, Object> fileUpload = (Map<String, Object>) ((Map<String, Object>) paths.get("/api/v1/files/upload")).get("post");
        Map<String, Object> uploadResponses = (Map<String, Object>) fileUpload.get("responses");
        assertThat(uploadResponses).containsKey("429");
    }
}
