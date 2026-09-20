package com.greenwhite.dwh.instance.common.security;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.security.web.util.matcher.IpAddressMatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Сервис безопасного определения IP-адреса и протокола клиента (H05, FR-SEC-2).
 * <p>
 * Предотвращает спуфинг IP через заголовок {@code X-Forwarded-For}:
 * <ul>
 *   <li>Если прямой адрес соединения (remoteAddr) НЕ входит в доверенные подсети (trusted-proxies),
 *       заголовки X-Forwarded-* полностью игнорируются, а клиенту назначается его реальный remoteAddr.</li>
 *   <li>Если прямой адрес соединения ВХОДИТ в доверенные подсети, заголовок X-Forwarded-For
 *       разбирается справа налево (от ближайшего доверенного прокси), пропуская доверенные узлы
 *       внутренней сети. Первый недоверенный IP считается аутентичным адресом клиента.</li>
 * </ul>
 */
public class ClientIpResolver {

    private static final String DEFAULT_FALLBACK_IP = "127.0.0.1";
    private static final Pattern IPV4_PATTERN = Pattern.compile(
            "^((25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)\\.){3}(25[0-5]|(2[0-4]|1\\d|[1-9]|)\\d)$");

    private final List<IpAddressMatcher> matchers;

    public ClientIpResolver(TrustedProxyProperties properties) {
        List<String> subnets = (properties != null && properties.trustedProxies() != null && !properties.trustedProxies().isEmpty())
                ? properties.trustedProxies()
                : TrustedProxyProperties.DEFAULT_TRUSTED_PROXIES;

        this.matchers = new ArrayList<>();
        for (String subnet : subnets) {
            String trimmed = subnet.trim();
            if (!trimmed.isBlank()) {
                this.matchers.add(new IpAddressMatcher(trimmed));
            }
        }
    }

    /**
     * Проверяет, входит ли указанный IP-адрес в список доверенных прокси.
     */
    public boolean isTrustedProxy(String ip) {
        if (ip == null || ip.isBlank() || !isValidIp(ip)) {
            return false;
        }
        String clean = normalize(ip);
        for (IpAddressMatcher matcher : matchers) {
            if (matcher.matches(clean)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Извлекает реальный IP-адрес клиента с учётом доверенных прокси.
     */
    public String resolveClientIp(HttpServletRequest request) {
        if (request == null) {
            return DEFAULT_FALLBACK_IP;
        }

        String remoteAddr = normalize(request.getRemoteAddr());
        if (remoteAddr == null || remoteAddr.isBlank() || !isValidIp(remoteAddr)) {
            return DEFAULT_FALLBACK_IP;
        }

        // Если прямой пир не является доверенным прокси — игнорируем любые заголовки пересылки
        if (!isTrustedProxy(remoteAddr)) {
            return remoteAddr;
        }

        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank()) {
            return remoteAddr;
        }

        String[] hops = forwarded.split(",");
        // Идем справа налево: от ближайшего прокси к клиенту
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = normalize(hops[i]);
            if (hop == null || hop.isBlank() || !isValidIp(hop)) {
                continue;
            }
            if (!isTrustedProxy(hop)) {
                // Первый недоверенный IP справа — это настоящий клиент
                return hop;
            }
        }

        // Если все хопы доверенные (например, внутренняя инфраструктура), берем самый левый валидный IP
        for (String hopStr : hops) {
            String hop = normalize(hopStr);
            if (hop != null && !hop.isBlank() && isValidIp(hop)) {
                return hop;
            }
        }

        return remoteAddr;
    }

    /**
     * Определяет, является ли соединение защищенным (HTTPS), доверяя X-Forwarded-Proto
     * только при обращении через доверенный прокси.
     */
    public boolean isSecure(HttpServletRequest request) {
        if (request == null) {
            return false;
        }
        if (request.isSecure()) {
            return true;
        }

        String remoteAddr = normalize(request.getRemoteAddr());
        if (remoteAddr != null && isTrustedProxy(remoteAddr)) {
            String proto = request.getHeader("X-Forwarded-Proto");
            if (proto != null && !proto.isBlank()) {
                String firstProto = proto.split(",")[0].trim();
                return "https".equalsIgnoreCase(firstProto);
            }
        }

        return false;
    }

    private static String normalize(String ip) {
        if (ip == null) {
            return null;
        }
        String clean = ip.trim();
        // Удаление IPv6 scope id (например, fe80::1%eth0)
        int percentIdx = clean.indexOf('%');
        if (percentIdx > 0) {
            clean = clean.substring(0, percentIdx);
        }
        return clean;
    }

    private static boolean isValidIp(String ip) {
        if (ip == null || ip.isBlank()) {
            return false;
        }
        String clean = ip.trim();
        if (IPV4_PATTERN.matcher(clean).matches()) {
            return true;
        }
        // IPv6 проверка формата
        return clean.contains(":") && clean.matches("^[0-9a-fA-F:]+$") && !clean.contains(":::");
    }
}
