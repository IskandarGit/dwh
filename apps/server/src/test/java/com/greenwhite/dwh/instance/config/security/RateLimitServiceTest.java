package com.greenwhite.dwh.instance.config.security;

import io.github.bucket4j.TimeMeter;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimitServiceTest {

    @Test
    void capacityBoundsImmediateSearchBurstBelowPerMinuteRate() {
        var time = new MutableTimeMeter();
        var service = new RateLimitService(time);

        for (int request = 0; request < 20; request++) {
            assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isTrue();
        }

        var rejected = service.tryConsume("user:42:search", 120, 20);
        assertThat(rejected.isConsumed()).isFalse();
        assertThat(rejected.getNanosToWaitForRefill()).isPositive();
    }

    @Test
    void alternatingRateOnlyReplacementDoesNotGrantTokensToExhaustedBucket() {
        var time = new MutableTimeMeter();
        var service = new RateLimitService(time);

        for (int request = 0; request < 20; request++) {
            assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isTrue();
        }
        for (int replacement = 0; replacement < 10; replacement++) {
            assertThat(service.tryConsume("user:42:search", 119, 20).isConsumed()).isFalse();
            assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isFalse();
        }
    }

    @Test
    void rateOnlyReplacementAppliesNewRefillRate() {
        var time = new MutableTimeMeter();
        var service = new RateLimitService(time);

        for (int request = 0; request < 20; request++) {
            assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isTrue();
        }
        assertThat(service.tryConsume("user:42:search", 119, 20).isConsumed()).isFalse();

        time.advance(Duration.ofMillis(500));
        assertThat(service.tryConsume("user:42:search", 119, 20).isConsumed()).isFalse();
        time.advance(Duration.ofMillis(5));
        assertThat(service.tryConsume("user:42:search", 119, 20).isConsumed()).isTrue();
    }

    @Test
    void replacementPreservesConsumedTokenDebtAfterTimeAdvances() {
        var time = new MutableTimeMeter();
        var service = new RateLimitService(time);

        for (int request = 0; request < 20; request++) {
            assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isTrue();
        }
        time.advance(Duration.ofMillis(500));
        assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isTrue();

        assertThat(service.tryConsume("user:42:search", 60, 10).isConsumed()).isFalse();
        assertThat(service.tryConsume("user:42:search", 120, 20).isConsumed()).isFalse();
    }

    @Test
    void capacityBoundPreventsUnboundedMemoryGrowthUnderKeyFlooding() {
        int maxEntries = 200;
        var service = new RateLimitService(TimeMeter.SYSTEM_NANOTIME, maxEntries);

        for (int i = 0; i < 1000; i++) {
            service.tryConsume("spoofed-ip:" + i, 60, 60);
        }

        service.cleanUp();

        assertThat(service.estimatedSize()).isLessThanOrEqualTo(maxEntries);
    }

    private static final class MutableTimeMeter implements TimeMeter {
        private final AtomicLong currentNanos = new AtomicLong();

        @Override
        public long currentTimeNanos() {
            return currentNanos.get();
        }

        @Override
        public boolean isWallClockBased() {
            return false;
        }

        void advance(Duration duration) {
            currentNanos.addAndGet(duration.toNanos());
        }
    }
}
