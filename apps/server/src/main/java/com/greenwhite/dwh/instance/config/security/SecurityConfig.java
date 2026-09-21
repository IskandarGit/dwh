package com.greenwhite.dwh.instance.config.security;

import com.greenwhite.dwh.instance.common.security.ClientIpResolver;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.common.security.TrustedProxyProperties;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.kauth.security.KauthAuthenticationFilter;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.session.NullAuthenticatedSessionStrategy;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.context.SecurityContextHolderFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;
import org.springframework.security.web.header.writers.StaticHeadersWriter;

@Configuration
@EnableWebSecurity
@EnableConfigurationProperties({RateLimitProperties.class, TrustedProxyProperties.class})
public class SecurityConfig {

    private static final String[] PUBLIC_PATHS = {
            "/api/v1/auth/login",
            "/api/v1/auth/otp",
            "/api/v1/auth/password-reset/**",
            "/api/v1/openapi.json",
            "/v3/api-docs/**",
            "/error"
    };

    @Bean
    CookieCsrfTokenRepository csrfTokenRepository() {
        CookieCsrfTokenRepository repository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        repository.setHeaderName("X-XSRF-TOKEN");
        repository.setCookieName("XSRF-TOKEN");
        repository.setCookiePath("/");
        return repository;
    }

    @Bean
    public ClientIpResolver clientIpResolver(TrustedProxyProperties properties) {
        return new ClientIpResolver(properties);
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            KauthAuthenticationFilter kauthAuthenticationFilter,
            RateLimitFilter rateLimitFilter,
            com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter idempotencyFilter,
            CookieCsrfTokenRepository tokenRepository,
            ProblemDetailAuthHandlers problemHandlers) throws Exception {

        http
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(csrf -> {
                    CsrfTokenRequestAttributeHandler requestHandler = new CsrfTokenRequestAttributeHandler();
                    requestHandler.setCsrfRequestAttributeName(null);

                    csrf.csrfTokenRepository(tokenRepository)
                            .csrfTokenRequestHandler(requestHandler)
                            // Kauth revalidates credentials on every stateless request. Completed
                            // login/OTP and logout own CSRF renewal/clearing in KauthAuthController.
                            .sessionAuthenticationStrategy(new NullAuthenticatedSessionStrategy())
                            // FR-SEC-1: CSRF применяется к мутирующим запросам С cookie-аутентификацией.
                            // Только принятый API-токен освобождает запрос с сессионной cookie.
                            .ignoringRequestMatchers(SecurityConfig::isCsrfExempt);
                })

                .authorizeHttpRequests(auth -> auth
                        // ASYNC/ERROR are continuations of an already-authorized request. Re-authorizing
                        // them after an SSE/client disconnect can only produce a second, committed response.
                        .dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/i18n/languages").permitAll()
                        .requestMatchers(SecurityConfig::isPublicI18nDictionaryRead).permitAll()
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        // Actuator живёт на отдельном management-порту, наружу не публикуется
                        .requestMatchers("/actuator/**").permitAll()
                        .anyRequest().authenticated())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .anonymous(Customizer.withDefaults())
                .headers(headers -> headers
                        .contentSecurityPolicy(csp -> csp.policyDirectives(
                                "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'"))
                        .frameOptions(frame -> frame.deny())
                        .referrerPolicy(rp -> rp.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.SAME_ORIGIN))
                        .httpStrictTransportSecurity(hsts -> hsts
                                .includeSubDomains(true)
                                .maxAgeInSeconds(31_536_000))
                        .addHeaderWriter(new StaticHeadersWriter(
                                "Permissions-Policy", "geolocation=(), camera=(), microphone=()")))
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(problemHandlers)
                        .accessDeniedHandler(problemHandlers))
                // Порядок детерминирован: аутентификация -> лимиты -> идемпотентность -> авторизация
                .addFilterAfter(kauthAuthenticationFilter, SecurityContextHolderFilter.class)
                .addFilterBefore(rateLimitFilter, AuthorizationFilter.class)
                .addFilterAfter(idempotencyFilter, RateLimitFilter.class);

        return http.build();
    }

    @Bean
    FilterRegistrationBean<KauthAuthenticationFilter> kauthFilterAutoRegistrationDisabled(
            KauthAuthenticationFilter filter) {
        FilterRegistrationBean<KauthAuthenticationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    FilterRegistrationBean<RateLimitFilter> rateLimitFilterAutoRegistrationDisabled(RateLimitFilter filter) {
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    FilterRegistrationBean<com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter> idempotencyFilterAutoRegistrationDisabled(
            com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter filter) {
        FilterRegistrationBean<com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    private static boolean isCsrfExempt(HttpServletRequest request) {
        var principal = SecurityContext.getPrincipal();
        if (principal != null && principal.isApi()) {
            return true;
        }
        return !hasSessionCookie(request);
    }

    private static boolean isPublicI18nDictionaryRead(HttpServletRequest request) {
        return "GET".equals(request.getMethod())
                && request.getRequestURI().matches(
                        "^/api/v1/i18n/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$");
    }

    private static boolean hasSessionCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return false;
        }
        for (Cookie cookie : cookies) {
            if (KauthPref.SESSION_COOKIE_NAME.equals(cookie.getName())) {
                return true;
            }
        }
        return false;
    }
}
