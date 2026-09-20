package com.greenwhite.dwh.instance.config.security;

import com.greenwhite.dwh.instance.common.security.ClientIpResolver;
import com.greenwhite.dwh.instance.common.security.TrustedProxyProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class ClientIpResolverTest {

    private final ClientIpResolver defaultResolver = new ClientIpResolver(
            new TrustedProxyProperties(TrustedProxyProperties.DEFAULT_TRUSTED_PROXIES));

    @Test
    @DisplayName("Direct connection from untrusted IP ignores spoofed X-Forwarded-For")
    void directConnection_ignoresSpoofedXff() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("203.0.113.195");
        request.addHeader("X-Forwarded-For", "198.51.100.1, 10.0.0.1");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("203.0.113.195");
    }

    @Test
    @DisplayName("Trusted proxy single hop extracts authentic client IP from X-Forwarded-For")
    void trustedProxy_singleHop_extractsClientIp() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("172.18.0.2"); // Docker default bridge subnet 172.16.0.0/12
        request.addHeader("X-Forwarded-For", "203.0.113.50");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("203.0.113.50");
    }

    @Test
    @DisplayName("Trusted proxy multi-hop scans right-to-left and skips intermediate trusted proxies")
    void trustedProxy_multiHop_skipsIntermediateTrustedProxies() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.2"); // edge proxy
        // format: client, intermediate-proxy (e.g. company ingress or alb)
        request.addHeader("X-Forwarded-For", "203.0.113.50, 192.168.1.10");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("203.0.113.50");
    }

    @Test
    @DisplayName("When all hops are trusted, resolves to leftmost valid IP")
    void allHopsTrusted_resolvesToLeftmost() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        request.addHeader("X-Forwarded-For", "10.0.0.100, 192.168.1.20");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("10.0.0.100");
    }

    @Test
    @DisplayName("Missing or blank X-Forwarded-For returns remoteAddr")
    void missingOrBlankXff_returnsRemoteAddr() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");

        assertThat(defaultResolver.resolveClientIp(request)).isEqualTo("127.0.0.1");

        request.addHeader("X-Forwarded-For", "   ");
        assertThat(defaultResolver.resolveClientIp(request)).isEqualTo("127.0.0.1");
    }

    @Test
    @DisplayName("Malformed or injection entries in XFF are skipped safely without DNS lookups")
    void malformedHops_skippedSafely() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.2");
        request.addHeader("X-Forwarded-For", "203.0.113.55, malicious.host.com, <script>, 10.0.0.5");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("203.0.113.55");
    }

    @Test
    @DisplayName("All malformed hops fall back to remoteAddr")
    void allMalformedHops_fallBackToRemoteAddr() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("10.0.0.2");
        request.addHeader("X-Forwarded-For", "not_an_ip, 999.999.999.999");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("10.0.0.2");
    }

    @Test
    @DisplayName("Supports IPv6 addresses and scope IDs")
    void ipv6Support() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("::1");
        request.addHeader("X-Forwarded-For", "2001:db8:85a3::8a2e:370:7334");

        String resolvedIp = defaultResolver.resolveClientIp(request);

        assertThat(resolvedIp).isEqualTo("2001:db8:85a3::8a2e:370:7334");
    }

    @Test
    @DisplayName("Custom trusted proxy subnet configuration works as expected")
    void customTrustedSubnet() {
        ClientIpResolver customResolver = new ClientIpResolver(
                new TrustedProxyProperties(List.of("198.51.100.0/24")));

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("198.51.100.5");
        request.addHeader("X-Forwarded-For", "93.184.216.34");

        assertThat(customResolver.resolveClientIp(request)).isEqualTo("93.184.216.34");

        // 127.0.0.1 is not in custom list
        MockHttpServletRequest untrustedRequest = new MockHttpServletRequest();
        untrustedRequest.setRemoteAddr("127.0.0.1");
        untrustedRequest.addHeader("X-Forwarded-For", "93.184.216.34");

        assertThat(customResolver.resolveClientIp(untrustedRequest)).isEqualTo("127.0.0.1");
    }

    @Test
    @DisplayName("isSecure only trusts X-Forwarded-Proto when remoteAddr is a trusted proxy")
    void isSecure_verification() {
        // Direct HTTPS
        MockHttpServletRequest directHttps = new MockHttpServletRequest();
        directHttps.setSecure(true);
        directHttps.setRemoteAddr("203.0.113.1");
        assertThat(defaultResolver.isSecure(directHttps)).isTrue();

        // Untrusted peer spoofing X-Forwarded-Proto
        MockHttpServletRequest untrustedSpoof = new MockHttpServletRequest();
        untrustedSpoof.setSecure(false);
        untrustedSpoof.setRemoteAddr("203.0.113.1");
        untrustedSpoof.addHeader("X-Forwarded-Proto", "https");
        assertThat(defaultResolver.isSecure(untrustedSpoof)).isFalse();

        // Trusted proxy forwarding https
        MockHttpServletRequest trustedHttps = new MockHttpServletRequest();
        trustedHttps.setSecure(false);
        trustedHttps.setRemoteAddr("127.0.0.1");
        trustedHttps.addHeader("X-Forwarded-Proto", "https");
        assertThat(defaultResolver.isSecure(trustedHttps)).isTrue();

        // Trusted proxy forwarding http
        MockHttpServletRequest trustedHttp = new MockHttpServletRequest();
        trustedHttp.setSecure(false);
        trustedHttp.setRemoteAddr("127.0.0.1");
        trustedHttp.addHeader("X-Forwarded-Proto", "http");
        assertThat(defaultResolver.isSecure(trustedHttp)).isFalse();

        // Multi-value proto header
        MockHttpServletRequest multiProto = new MockHttpServletRequest();
        multiProto.setSecure(false);
        multiProto.setRemoteAddr("172.20.0.1");
        multiProto.addHeader("X-Forwarded-Proto", "https, http");
        assertThat(defaultResolver.isSecure(multiProto)).isTrue();
    }
}
