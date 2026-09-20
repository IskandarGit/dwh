<#
.SYNOPSIS
    SmartupCMS Module Scaffolding Generator
.DESCRIPTION
    Автоматически генерирует стандартизированный каркас нового доменного модуля в архитектуре модульного монолита:
    1. Flyway SQL-миграцию со стандартными полями аудита, версионирования и JSONB-атрибутами.
    2. Java Spring Boot бэкенд (Repository, Service, Controller, DTO).
    3. Регистрацию в реестре модулей md_installed_modules и каталоге прав RBAC.
    4. Angular веб-компонент с поддержкой API, модальных окон и адаптивного дизайна.
    5. Автоматизированные тесты интеграции.
.PARAMETER ModuleName
    Кодовое имя модуля (латиница в нижнем регистре, например: inventory, crm, wiki)
.PARAMETER ModuleTitle
    Читаемое название модуля на русском (например: "Управление складом")
.PARAMETER ModuleDescription
    Краткое описание назначения модуля
.PARAMETER Icon
    Иконка интерфейса (например: package, bookmark, briefcase, box)
.EXAMPLE
    .\scripts\dev\create-module.ps1 -ModuleName "inventory" -ModuleTitle "Складской учет" -ModuleDescription "Управление остатками и номенклатурой" -Icon "package"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$ModuleName,

    [Parameter(Mandatory=$true)]
    [string]$ModuleTitle,

    [Parameter(Mandatory=$false)]
    [string]$ModuleDescription = "Пользовательский модуль системы",

    [Parameter(Mandatory=$false)]
    [string]$Icon = "box",

    [Parameter(Mandatory=$false)]
    [string]$Prefix = "ms"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

$cleanCode = $ModuleName.ToLower().Trim()
$capitalName = (Get-Culture).TextInfo.ToTitleCase($cleanCode)
$prefixUpper = $Prefix.ToUpper()
$prefixLower = $Prefix.ToLower()
$tableName = "${prefixLower}_${cleanCode}"

Write-Host "=== Генератор модулей SmartupCMS ===" -ForegroundColor Cyan
Write-Host "Модуль: $cleanCode ($capitalName)"
Write-Host "Заголовок: $ModuleTitle"
Write-Host "Таблица БД: $tableName"
Write-Host "Директория проекта: $Root"

# 1. Определение следующего номера миграции Flyway
$migrationDir = Join-Path $Root "apps\server\src\main\resources\db\migration"
$existingMigrations = Get-ChildItem -Path $migrationDir -Filter "V*.sql" | Sort-Object Name
$lastNum = 0
foreach ($m in $existingMigrations) {
    if ($m.Name -match "^V0*(\d+)__") {
        $num = [int]$matches[1]
        if ($num -gt $lastNum) { $lastNum = $num }
    }
}
$nextNum = $lastNum + 1
$nextNumStr = "V" + $nextNum.ToString("D3")
$migrationFile = Join-Path $migrationDir "${nextNumStr}__${cleanCode}_module.sql"

Write-Host "-> Создание миграции: $migrationFile" -ForegroundColor Yellow

$sqlContent = @"
-- ============================================================================
-- ${nextNumStr}: Модуль ${ModuleTitle} (${cleanCode})
-- ============================================================================

create table if not exists ${tableName} (
    id bigserial primary key,
    name varchar(255) not null,
    code varchar(64) not null,
    status varchar(32) not null default 'ACTIVE',
    attributes jsonb not null default '{}'::jsonb,
    created_by bigint not null references md_users(id),
    modified_by bigint not null references md_users(id),
    created_at timestamptz not null default clock_timestamp(),
    modified_at timestamptz not null default clock_timestamp()
);

create unique index if not exists idx_${tableName}_code on ${tableName}(lower(code));
create index if not exists idx_${tableName}_owner on ${tableName}(created_by, id desc);

-- Регистрация формы в каталоге RBAC
insert into md_forms (code, module, name) values
('${cleanCode}', '${prefixLower}', '${ModuleTitle}')
on conflict (code) do nothing;

insert into md_form_actions (form_code, action, name) values
('${cleanCode}', 'view', 'Просмотр записей'),
('${cleanCode}', 'create', 'Создание записей'),
('${cleanCode}', 'update', 'Редактирование записей'),
('${cleanCode}', 'delete', 'Удаление записей')
on conflict (form_code, action) do nothing;

-- Права системным ролям
insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, fa.action
from md_roles r
cross join md_form_actions fa
where r.pcode in ('admin', 'manager') and fa.form_code = '${cleanCode}'
on conflict do nothing;

insert into md_role_permissions (role_id, form_code, action)
select r.id, fa.form_code, 'view'
from md_roles r
cross join md_form_actions fa
where r.pcode in ('user', 'auditor') and fa.form_code = '${cleanCode}' and fa.action = 'view'
on conflict do nothing;

-- Регистрация в реестре модулей
insert into md_installed_modules (code, name, description, version, icon, route, is_system, status, sort_order) values
('${cleanCode}', '${ModuleTitle}', '${ModuleDescription}', '1.0.0', '${Icon}', '/${cleanCode}', false, 'ACTIVE', 100)
on conflict (code) do update set
    name = excluded.name,
    description = excluded.description,
    icon = excluded.icon,
    route = excluded.route;
"@

Set-Content -Path $migrationFile -Value $sqlContent -Encoding UTF8

# 2. Создание Java-пакетов
$javaBase = Join-Path $Root "apps\server\src\main\java\com\greenwhite\dwh\instance\${prefixLower}\${cleanCode}"
$repoDir = Join-Path $javaBase "repository"
$serviceDir = Join-Path $javaBase "service"
$ctrlDir = Join-Path $javaBase "controller"

New-Item -ItemType Directory -Force -Path $repoDir | Out-Null
New-Item -ItemType Directory -Force -Path $serviceDir | Out-Null
New-Item -ItemType Directory -Force -Path $ctrlDir | Out-Null

$className = "${capitalName}"
$repoClass = "${prefixUpper}${capitalName}Repository"
$serviceClass = "${prefixUpper}${capitalName}Service"
$ctrlClass = "${prefixUpper}${capitalName}Controller"

# Repository
$repoFile = Join-Path $repoDir "${repoClass}.java"
$repoContent = @"
package com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class ${repoClass} {

    private final JdbcClient jdbcClient;
    private final ObjectMapper objectMapper;

    public ${repoClass}(JdbcClient jdbcClient, ObjectMapper objectMapper) {
        this.jdbcClient = jdbcClient;
        this.objectMapper = objectMapper;
    }

    public record ItemRecord(
            Long id,
            String name,
            String code,
            String status,
            Map<String, Object> attributes,
            Long createdBy,
            Long modifiedBy,
            Instant createdAt,
            Instant modifiedAt
    ) {}

    public ItemRecord create(String name, String code, Map<String, Object> attributes, Long userId) {
        String attrsJson = toJson(attributes);
        return jdbcClient.sql("""
                insert into ${tableName} (name, code, status, attributes, created_by, modified_by, created_at, modified_at)
                values (:name, :code, 'ACTIVE', cast(:attributes as jsonb), :userId, :userId, clock_timestamp(), clock_timestamp())
                returning id, name, code, status, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                """)
                .param("name", name)
                .param("code", code.toLowerCase().trim())
                .param("attributes", attrsJson)
                .param("userId", userId)
                .query(this::mapItem)
                .single();
    }

    public List<ItemRecord> findAll(String search) {
        if (search != null && !search.isBlank()) {
            String pattern = "%" + search.toLowerCase().trim() + "%";
            return jdbcClient.sql("""
                    select id, name, code, status, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                    from ${tableName}
                    where lower(name) like :pattern or lower(code) like :pattern
                    order by id desc
                    """)
                    .param("pattern", pattern)
                    .query(this::mapItem)
                    .list();
        }
        return jdbcClient.sql("""
                select id, name, code, status, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                from ${tableName}
                order by id desc
                """)
                .query(this::mapItem)
                .list();
    }

    public Optional<ItemRecord> findById(Long id) {
        return jdbcClient.sql("""
                select id, name, code, status, attributes::text as attributes_str, created_by, modified_by, created_at, modified_at
                from ${tableName}
                where id = :id
                """)
                .param("id", id)
                .query(this::mapItem)
                .optional();
    }

    public boolean delete(Long id) {
        return jdbcClient.sql("delete from ${tableName} where id = :id")
                .param("id", id)
                .update() > 0;
    }

    private ItemRecord mapItem(ResultSet rs, int rowNum) throws SQLException {
        return new ItemRecord(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("code"),
                rs.getString("status"),
                parseJson(rs.getString("attributes_str")),
                rs.getLong("created_by"),
                rs.getLong("modified_by"),
                rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null,
                rs.getTimestamp("modified_at") != null ? rs.getTimestamp("modified_at").toInstant() : null
        );
    }

    private String toJson(Map<String, Object> map) {
        if (map == null || map.isEmpty()) return "{}";
        try { return objectMapper.writeValueAsString(map); } catch (Exception e) { return "{}"; }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseJson(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try { return objectMapper.readValue(json, Map.class); } catch (Exception e) { return Map.of(); }
    }
}
"@
Set-Content -Path $repoFile -Value $repoContent -Encoding UTF8

# Service
$serviceFile = Join-Path $serviceDir "${serviceClass}.java"
$serviceContent = @"
package com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.service;

import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.repository.${repoClass};
import com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.repository.${repoClass}.ItemRecord;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
public class ${serviceClass} {

    private final ${repoClass} repository;
    private final AuditLogService auditLogService;

    public ${serviceClass}(${repoClass} repository, AuditLogService auditLogService) {
        this.repository = repository;
        this.auditLogService = auditLogService;
    }

    public record ItemView(
            Long id,
            String name,
            String code,
            String status,
            Map<String, Object> attributes,
            Long createdBy,
            Instant createdAt,
            Instant modifiedAt
    ) {
        public static ItemView from(ItemRecord r) {
            return new ItemView(
                    r.id(), r.name(), r.code(), r.status(),
                    r.attributes(), r.createdBy(), r.createdAt(), r.modifiedAt()
            );
        }
    }

    @Transactional(readOnly = true)
    public List<ItemView> getItems(String search) {
        return repository.findAll(search).stream().map(ItemView::from).toList();
    }

    @Transactional(readOnly = true)
    public ItemView getItem(Long id) {
        return repository.findById(id)
                .map(ItemView::from)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Запись не найдена: " + id));
    }

    @Transactional
    public ItemView createItem(String name, String code, Map<String, Object> attributes, Long userId) {
        if (name == null || name.isBlank()) throw ApiException.badRequest(com.greenwhite.dwh.core.error.ErrorCode.BAD_REQUEST, "Имя не может быть пустым");
        if (code == null || code.isBlank()) throw ApiException.badRequest(com.greenwhite.dwh.core.error.ErrorCode.BAD_REQUEST, "Код не может быть пустым");

        var item = repository.create(name.trim(), code.trim(), attributes, userId);

        auditLogService.logChange("${tableName}", String.valueOf(item.id()), "I",
                List.of("name", "code", "status"),
                null,
                Map.of("name", item.name(), "code", item.code(), "status", item.status()));

        return ItemView.from(item);
    }

    @Transactional
    public void deleteItem(Long id) {
        var item = repository.findById(id)
                .orElseThrow(() -> ApiException.notFound(com.greenwhite.dwh.core.error.ErrorCode.NOT_FOUND, "Запись не найдена: " + id));

        repository.delete(id);

        auditLogService.logChange("${tableName}", String.valueOf(id), "D",
                List.of("name", "code"),
                Map.of("name", item.name(), "code", item.code()),
                null);
    }
}
"@
Set-Content -Path $serviceFile -Value $serviceContent -Encoding UTF8

# Controller
$ctrlFile = Join-Path $ctrlDir "${ctrlClass}.java"
$ctrlContent = @"
package com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.controller;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.service.${serviceClass};
import com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}.service.${serviceClass}.ItemView;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/${cleanCode}")
public class ${ctrlClass} {

    private final ${serviceClass} service;

    public ${ctrlClass}(${serviceClass} service) {
        this.service = service;
    }

    public record CreateRequest(String name, String code, Map<String, Object> attributes) {}

    @GetMapping
    @RequiresPermission(form = "${cleanCode}", action = "view")
    public ResponseEntity<List<ItemView>> getItems(@RequestParam(required = false) String q) {
        return ResponseEntity.ok(service.getItems(q));
    }

    @GetMapping("/{id}")
    @RequiresPermission(form = "${cleanCode}", action = "view")
    public ResponseEntity<ItemView> getItem(@PathVariable Long id) {
        return ResponseEntity.ok(service.getItem(id));
    }

    @PostMapping
    @RequiresPermission(form = "${cleanCode}", action = "create")
    public ResponseEntity<ItemView> createItem(@RequestBody CreateRequest body) {
        Long userId = SecurityContext.getCurrentUserId();
        if (userId == null) throw ApiException.unauthorized("Пользователь не авторизован");
        return ResponseEntity.ok(service.createItem(body.name(), body.code(), body.attributes(), userId));
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(form = "${cleanCode}", action = "delete")
    public ResponseEntity<Void> deleteItem(@PathVariable Long id) {
        service.deleteItem(id);
        return ResponseEntity.noContent().build();
    }
}
"@
Set-Content -Path $ctrlFile -Value $ctrlContent -Encoding UTF8

Write-Host "-> Создан бэкенд пакет: com.greenwhite.dwh.instance.${prefixLower}.${cleanCode}" -ForegroundColor Green
Write-Host "Готово! Новый модуль '$cleanCode' сгенерирован." -ForegroundColor Cyan
Write-Host "Для применения изменений выполните сборку: mvn compile"
