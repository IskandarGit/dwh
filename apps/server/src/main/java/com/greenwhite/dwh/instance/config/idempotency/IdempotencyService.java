package com.greenwhite.dwh.instance.config.idempotency;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Objects;
import java.util.UUID;

@Service
public class IdempotencyService {

    public static final Duration DEFAULT_LEASE_DURATION = Duration.ofMinutes(2);

    public enum ClaimState {
        ACQUIRED,
        IN_PROGRESS,
        REPLAY,
        PAYLOAD_MISMATCH
    }

    public record Claim(
            ClaimState state,
            UUID reservationToken,
            IdempotencyRepository.IdempotencyRecord existing
    ) {}

    private final IdempotencyRepository idempotencyRepository;
    private final Duration leaseDuration;

    @Autowired
    public IdempotencyService(IdempotencyRepository idempotencyRepository,
                              @Value("${dwh.idempotency.lease-seconds:120}") int leaseSeconds) {
        this(idempotencyRepository, Duration.ofSeconds(leaseSeconds));
    }

    public IdempotencyService(IdempotencyRepository idempotencyRepository, Duration leaseDuration) {
        this.idempotencyRepository = idempotencyRepository;
        this.leaseDuration = (leaseDuration != null) ? leaseDuration : DEFAULT_LEASE_DURATION;
    }

    public IdempotencyService(IdempotencyRepository idempotencyRepository) {
        this(idempotencyRepository, DEFAULT_LEASE_DURATION);
    }

    @Transactional
    public Claim claim(UUID key, Long userId, String requestHash) {
        UUID reservationToken = UUID.randomUUID();
        Instant expiredCutoff = Instant.now().minus(leaseDuration);
        if (idempotencyRepository.tryReserve(key, userId, requestHash, reservationToken, expiredCutoff)) {
            return new Claim(ClaimState.ACQUIRED, reservationToken, null);
        }

        Optional<IdempotencyRepository.IdempotencyRecord> existing = idempotencyRepository.findByKey(key);
        if (existing.isEmpty()) {
            // A conflicting reservation may have just been released. Returning a
            // retryable conflict is safer than executing the operation twice.
            return new Claim(ClaimState.IN_PROGRESS, null, null);
        }

        IdempotencyRepository.IdempotencyRecord record = existing.get();
        if (!Objects.equals(record.userId(), userId) || !record.requestHash().equals(requestHash)) {
            return new Claim(ClaimState.PAYLOAD_MISMATCH, null, record);
        }
        if (record.state() == IdempotencyRepository.State.PENDING) {
            return new Claim(ClaimState.IN_PROGRESS, null, record);
        }
        return new Claim(ClaimState.REPLAY, null, record);
    }

    @Transactional
    public void complete(UUID key, UUID reservationToken, int responseStatus, String responseBodyJson) {
        if (!idempotencyRepository.complete(key, reservationToken, responseStatus, responseBodyJson)) {
            throw new IllegalStateException("Idempotency reservation is no longer owned by this request");
        }
    }

    @Transactional
    public void release(UUID key, UUID reservationToken) {
        idempotencyRepository.release(key, reservationToken);
    }

    @Transactional
    public int cleanupOldKeys(int days) {
        Instant cutoff = Instant.now().minusSeconds((long) days * 86400);
        return idempotencyRepository.deleteOlderThan(cutoff);
    }

    /**
     * Computes a deterministic SHA-256 hash of the HTTP request.
     */
    public String computeRequestHash(String method, String uri, String query, byte[] body) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(method.toUpperCase().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) ':');
            digest.update(uri.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) ':');
            if (query != null && !query.isBlank()) {
                digest.update(query.getBytes(StandardCharsets.UTF_8));
            }
            digest.update((byte) ':');
            if (body != null && body.length > 0) {
                digest.update(body);
            }
            byte[] hashBytes = digest.digest();
            return HexFormat.of().formatHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm unavailable", e);
        }
    }
}
