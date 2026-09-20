package com.greenwhite.dwh.instance.config.idempotency;

import com.greenwhite.dwh.core.error.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class IdempotencyFilterTest {

    private IdempotencyService idempotencyService;
    private IdempotencyFilter filter;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setup() {
        idempotencyService = Mockito.mock(IdempotencyService.class);
        objectMapper = new ObjectMapper();
        filter = new IdempotencyFilter(idempotencyService, objectMapper);
    }

    @Test
    @DisplayName("Запрос без заголовка Idempotency-Key выполняется через стандартный FilterChain")
    void shouldBypassWhenNoHeader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("GET запрос с Idempotency-Key игнорируется и выполняется через стандартный FilterChain")
    void shouldBypassForNonMutatingMethod() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, UUID.randomUUID().toString());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        verify(chain).doFilter(request, response);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("Запрос с некорректным UUID в заголовке возвращает 400 IDEMPOTENCY_KEY_INVALID")
    void shouldRejectInvalidUuidHeader() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, "not-a-valid-uuid");
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_BAD_REQUEST);
        assertThat(response.getContentAsString()).contains(ErrorCode.IDEMPOTENCY_KEY_INVALID.getCode());
        verifyNoInteractions(chain);
    }

    @Test
    @DisplayName("Запрос на /api/v1/auth/login с Idempotency-Key отклоняется (400 IDEMPOTENCY_NOT_SUPPORTED)")
    void shouldRejectAuthLoginEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/login");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, UUID.randomUUID().toString());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_BAD_REQUEST);
        assertThat(response.getContentAsString()).contains(ErrorCode.IDEMPOTENCY_NOT_SUPPORTED.getCode());
        assertThat(response.getContentAsString()).contains("не поддерживается для эндпоинтов авторизации");
        verifyNoInteractions(chain);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("Запрос на генерацию API-токена /api/v1/iam/profile/api-tokens отклоняется (400 IDEMPOTENCY_NOT_SUPPORTED)")
    void shouldRejectApiTokenCreationEndpoint() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/iam/profile/api-tokens");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, UUID.randomUUID().toString());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_BAD_REQUEST);
        assertThat(response.getContentAsString()).contains(ErrorCode.IDEMPOTENCY_NOT_SUPPORTED.getCode());
        verifyNoInteractions(chain);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("Multipart-запрос с Idempotency-Key отклоняется (400 IDEMPOTENCY_NOT_SUPPORTED)")
    void shouldRejectMultipartRequest() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/files/upload");
        request.setContentType("multipart/form-data; boundary=---boundary");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, UUID.randomUUID().toString());
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(HttpServletResponse.SC_BAD_REQUEST);
        assertThat(response.getContentAsString()).contains(ErrorCode.IDEMPOTENCY_NOT_SUPPORTED.getCode());
        assertThat(response.getContentAsString()).contains("multipart");
        verifyNoInteractions(chain);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("Запрос с телом больше 64 КБ отклоняется (413 PAYLOAD_TOO_LARGE)")
    void shouldRejectOversizedRequestBody() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, UUID.randomUUID().toString());
        request.setContentType("application/json");

        byte[] largeBody = new byte[IdempotencyFilter.MAX_REQUEST_BODY_BYTES + 100];
        request.setContent(largeBody);
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(response.getContentAsString()).contains(ErrorCode.PAYLOAD_TOO_LARGE.getCode());
        verifyNoInteractions(chain);
        verifyNoInteractions(idempotencyService);
    }

    @Test
    @DisplayName("Успешный первый запрос захватывает резервацию и сохраняет ответ")
    void shouldAcquireAndCompleteReservation() throws Exception {
        UUID key = UUID.randomUUID();
        UUID token = UUID.randomUUID();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, key.toString());
        request.setContentType("application/json");
        request.setContent("{\"title\":\"Task 1\"}".getBytes(StandardCharsets.UTF_8));

        when(idempotencyService.computeRequestHash(anyString(), anyString(), any(), any()))
                .thenReturn("hash123");
        when(idempotencyService.claim(eq(key), any(), eq("hash123")))
                .thenReturn(new IdempotencyService.Claim(IdempotencyService.ClaimState.ACQUIRED, token, null));

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> {
            HttpServletResponse httpRes = (HttpServletResponse) res;
            httpRes.setStatus(201);
            httpRes.getOutputStream().write("{\"id\":10}".getBytes(StandardCharsets.UTF_8));
        };

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(201);
        verify(idempotencyService).complete(eq(key), eq(token), eq(201), eq("{\"id\":10}"));
    }

    @Test
    @DisplayName("Повторный запрос возвращает закэшированный ответ с заголовком Idempotent-Replay: true")
    void shouldReplayCompletedResponse() throws Exception {
        UUID key = UUID.randomUUID();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, key.toString());
        request.setContentType("application/json");
        request.setContent("{\"title\":\"Task 1\"}".getBytes(StandardCharsets.UTF_8));

        var existing = new IdempotencyRepository.IdempotencyRecord(
                key, null, "hash123", 201, "{\"id\":10}",
                IdempotencyRepository.State.COMPLETED, java.time.Instant.now()
        );

        when(idempotencyService.computeRequestHash(anyString(), anyString(), any(), any()))
                .thenReturn("hash123");
        when(idempotencyService.claim(eq(key), any(), eq("hash123")))
                .thenReturn(new IdempotencyService.Claim(IdempotencyService.ClaimState.REPLAY, null, existing));

        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = Mockito.mock(FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(201);
        assertThat(response.getHeader(IdempotencyFilter.HEADER_IDEMPOTENT_REPLAY)).isEqualTo("true");
        assertThat(response.getContentAsString()).isEqualTo("{\"id\":10}");
        verifyNoInteractions(chain);
    }

    @Test
    @DisplayName("Ответ размером более 64 КБ освобождает резервацию и не сохраняется в БД")
    void shouldReleaseReservationWhenResponseOversized() throws Exception {
        UUID key = UUID.randomUUID();
        UUID token = UUID.randomUUID();
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/tasks/items");
        request.addHeader(IdempotencyFilter.HEADER_IDEMPOTENCY_KEY, key.toString());
        request.setContentType("application/json");
        request.setContent("{\"title\":\"Task 1\"}".getBytes(StandardCharsets.UTF_8));

        when(idempotencyService.computeRequestHash(anyString(), anyString(), any(), any()))
                .thenReturn("hash123");
        when(idempotencyService.claim(eq(key), any(), eq("hash123")))
                .thenReturn(new IdempotencyService.Claim(IdempotencyService.ClaimState.ACQUIRED, token, null));

        byte[] oversizedResponse = new byte[IdempotencyFilter.MAX_RESPONSE_BODY_BYTES + 50];
        MockHttpServletResponse response = new MockHttpServletResponse();
        FilterChain chain = (req, res) -> {
            HttpServletResponse httpRes = (HttpServletResponse) res;
            httpRes.setStatus(200);
            httpRes.getOutputStream().write(oversizedResponse);
        };

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(200);
        verify(idempotencyService, never()).complete(any(), any(), anyInt(), anyString());
        verify(idempotencyService).release(eq(key), eq(token));
    }
}
