package com.greenwhite.dwh.instance.kauth.security;

import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.kauth.pref.KauthPref;
import com.greenwhite.dwh.instance.kauth.service.KauthApiTokenService;
import com.greenwhite.dwh.instance.kauth.service.KauthSessionService;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.service.MdPermissionService;
import com.greenwhite.dwh.instance.md.service.MdUserService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Set;

/**
 * Аутентификация Bearer API-токеном или cookie-сессией.
 * Участвует ТОЛЬКО в цепочке Spring Security (см. SecurityConfig:
 * авто-регистрация в servlet-контейнере отключена). Заполняет оба контекста:
 * наш thread-local SecurityContext (RBAC-интерцептор) и SecurityContextHolder
 * (авторизация Spring Security).
 */
@Component
public class KauthAuthenticationFilter extends OncePerRequestFilter {

    private final KauthSessionService sessionService;
    private final KauthApiTokenService apiTokenService;
    private final MdUserService userService;
    private final MdPermissionService permissionService;

    public KauthAuthenticationFilter(
            KauthSessionService sessionService,
            KauthApiTokenService apiTokenService,
            MdUserService userService,
            MdPermissionService permissionService) {
        this.sessionService = sessionService;
        this.apiTokenService = apiTokenService;
        this.userService = userService;
        this.permissionService = permissionService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        try {
            // 1. Try Bearer API Token
            String authHeader = request.getHeader("Authorization");
            if (authHeader != null && authHeader.startsWith("Bearer ")) {
                String rawToken = authHeader.substring(7).trim();
                var tokenOpt = apiTokenService.validateToken(rawToken);
                if (tokenOpt.isPresent()) {
                    var token = tokenOpt.get();
                    try {
                        var user = userService.getUserById(token.userId());
                        if (MdPref.STATE_ACTIVE.equals(user.state()) && user.authenticationVersion() == token.authenticationVersion()) {
                            apiTokenService.recordTokenUsage(token.id());
                            Set<String> permissions = permissionService.getEffectivePermissions(user.id());
                            long version = permissionService.getPermissionVersion(user.id());
                            authenticate(new SecurityContext.KauthPrincipal(
                                    user.id(), user.login(), user.email(), null, true, permissions, version, user.forcePasswordChange(), token.authenticationVersion(), token.id()
                            ));
                        }
                    } catch (DataAccessException e) {
                        throw e;
                    } catch (Exception ignored) {}
                }
            }

            // 2. Try Cookie Session
            if (!SecurityContext.isAuthenticated()) {
                String sessionCookieValue = extractSessionCookie(request);
                if (sessionCookieValue != null) {
                    var sessionOpt = sessionService.getActiveSession(sessionCookieValue);
                    if (sessionOpt.isPresent()) {
                        var session = sessionOpt.get();
                        try {
                            var user = userService.getUserById(session.userId());
                            if (MdPref.STATE_ACTIVE.equals(user.state()) && user.authenticationVersion() == session.authenticationVersion()) {
                                sessionService.updateLastSeen(session.id());
                                Set<String> permissions = permissionService.getEffectivePermissions(user.id());
                                long version = permissionService.getPermissionVersion(user.id());
                                authenticate(new SecurityContext.KauthPrincipal(
                                        user.id(), user.login(), user.email(), session.id(), false, permissions, version, user.forcePasswordChange(), session.authenticationVersion(), null
                                ));
                            }
                        } catch (DataAccessException e) {
                            throw e;
                        } catch (Exception ignored) {}
                    }
                }
            }

            filterChain.doFilter(request, response);
        } finally {
            // SecurityContextHolder чистит SecurityContextHolderFilter самой цепочки —
            // ручная очистка здесь стирала бы аутентификацию ДО того, как
            // ExceptionTranslationFilter (выше по цепочке) разберёт исключение.
            SecurityContext.clear();
        }
    }

    private void authenticate(SecurityContext.KauthPrincipal principal) {
        SecurityContext.setPrincipal(principal);
        var authority = new SimpleGrantedAuthority(principal.isApi() ? "ROLE_API" : "ROLE_USER");
        var authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal, null, List.of(authority));
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }

    private String extractSessionCookie(HttpServletRequest request) {
        if (request.getCookies() == null) {
            return null;
        }
        for (Cookie cookie : request.getCookies()) {
            if (KauthPref.SESSION_COOKIE_NAME.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }
}
