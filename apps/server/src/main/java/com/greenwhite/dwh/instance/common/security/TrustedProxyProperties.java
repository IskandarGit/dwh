package com.greenwhite.dwh.instance.common.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * Конфигурация доверенных прокси-серверов и сетей (H05, FR-SEC-2).
 * <p>
 * По умолчанию включает:
 * <ul>
 *   <li>127.0.0.1/32, ::1/128 (loopback)</li>
 *   <li>10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (частные сети IPv4, включая Docker Bridge/Compose)</li>
 *   <li>fc00::/7, fe80::/10 (локальные и link-local сети IPv6)</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "dwh.security")
public record TrustedProxyProperties(
        List<String> trustedProxies
) {
    public static final List<String> DEFAULT_TRUSTED_PROXIES = List.of(
            "127.0.0.1/32",
            "::1/128",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "fc00::/7",
            "fe80::/10"
    );

    public TrustedProxyProperties {
        if (trustedProxies == null || trustedProxies.isEmpty()) {
            trustedProxies = DEFAULT_TRUSTED_PROXIES;
        }
    }
}
