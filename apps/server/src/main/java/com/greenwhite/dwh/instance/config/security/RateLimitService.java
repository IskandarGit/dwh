package com.greenwhite.dwh.instance.config.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.BucketConfiguration;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.Refill;
import io.github.bucket4j.TimeMeter;
import io.github.bucket4j.TokensInheritanceStrategy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-memory bucket'ы Bucket4j по ключу (ip:/user:/api:). Достаточно для одного
 * инстанса приложения на экземпляр (ТЗ-01: несколько нод — отдельное решение).
 * Ограничение роста карты (H05, FR-SEC-2): хранилище ограничено Caffeine Cache
 * с жестким лимитом емкости (максимум maxEntries, по умолчанию 10_000) и
 * автоматическим вытеснением W-TinyLFU / expireAfterAccess(10 минут).
 */
@Service
public class RateLimitService {

    public static final int DEFAULT_MAX_ENTRIES = 10_000;
    private static final Duration DEFAULT_EXPIRE_AFTER_ACCESS = Duration.ofMinutes(10);

    private final Cache<String, Entry> buckets;
    private final TimeMeter timeMeter;

    public RateLimitService() {
        this(TimeMeter.SYSTEM_NANOTIME, DEFAULT_MAX_ENTRIES);
    }

    @Autowired
    public RateLimitService(RateLimitProperties props) {
        this(TimeMeter.SYSTEM_NANOTIME, props != null ? props.maxEntries() : DEFAULT_MAX_ENTRIES);
    }

    RateLimitService(TimeMeter timeMeter) {
        this(timeMeter, DEFAULT_MAX_ENTRIES);
    }

    RateLimitService(TimeMeter timeMeter, int maxEntries) {
        this.timeMeter = timeMeter;
        int capacity = Math.max(100, maxEntries);
        this.buckets = Caffeine.newBuilder()
                .maximumSize(capacity)
                .expireAfterAccess(DEFAULT_EXPIRE_AFTER_ACCESS)
                .build();
    }

    /** Пытается списать 1 токен; возвращает probe с остатком и временем до пополнения. */
    public ConsumptionProbe tryConsume(String key, int limitPerMinute) {
        return tryConsume(key, limitPerMinute, limitPerMinute);
    }

    public ConsumptionProbe tryConsume(String key, int limitPerMinute, int capacity) {
        Budget budget = new Budget(limitPerMinute, capacity);
        Entry entry = buckets.get(key, k -> new Entry(newBucket(budget), budget));
        entry.lastAccessMs.set(System.currentTimeMillis());
        synchronized (entry) {
            if (!budget.equals(entry.budget)) {
                entry.bucket.replaceConfiguration(configuration(budget), TokensInheritanceStrategy.AS_IS);
                entry.budget = budget;
            }
            return entry.bucket.tryConsumeAndReturnRemaining(1);
        }
    }

    /**
     * Анти-флуд для security-журнала: true не чаще раза в минуту на ключ —
     * иначе атака превращала бы журнал во вторую жертву.
     */
    public boolean shouldLogRejection(String key) {
        Entry entry = buckets.getIfPresent(key);
        if (entry == null) {
            return true;
        }
        long nowMin = System.currentTimeMillis() / 60_000;
        long prev = entry.lastLoggedMinute.get();
        return prev != nowMin && entry.lastLoggedMinute.compareAndSet(prev, nowMin);
    }

    /** Текущее расчетное число бакетов в памяти. */
    public long estimatedSize() {
        return buckets.estimatedSize();
    }

    /** Синхронная очистка для тестов. */
    public void cleanUp() {
        buckets.cleanUp();
    }

    private Bucket newBucket(Budget budget) {
        return Bucket.builder()
                .withCustomTimePrecision(timeMeter)
                .addLimit(bandwidth(budget))
                .build();
    }

    private static BucketConfiguration configuration(Budget budget) {
        return BucketConfiguration.builder().addLimit(bandwidth(budget)).build();
    }

    private static Bandwidth bandwidth(Budget budget) {
        return Bandwidth.classic(budget.capacity,
                Refill.greedy(budget.perMinute, Duration.ofMinutes(1)));
    }

    private static final class Entry {
        private final Bucket bucket;
        private final AtomicLong lastAccessMs = new AtomicLong(System.currentTimeMillis());
        private final AtomicLong lastLoggedMinute = new AtomicLong(-1);
        private Budget budget;

        private Entry(Bucket bucket, Budget budget) {
            this.bucket = bucket;
            this.budget = budget;
        }
    }

    private record Budget(int perMinute, int capacity) {
        private Budget {
            if (perMinute < 1 || capacity < 1) {
                throw new IllegalArgumentException("Rate and capacity must be positive");
            }
        }
    }
}
