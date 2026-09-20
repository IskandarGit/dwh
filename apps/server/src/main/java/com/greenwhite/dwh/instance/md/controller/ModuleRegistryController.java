package com.greenwhite.dwh.instance.md.controller;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService;
import com.greenwhite.dwh.instance.md.service.ModuleRegistryService.InstalledModuleView;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/modules")
public class ModuleRegistryController {

    private final ModuleRegistryService moduleService;

    public ModuleRegistryController(ModuleRegistryService moduleService) {
        this.moduleService = moduleService;
    }

    public record ToggleStatusRequest(boolean enabled) {}
    public record RegisterModuleRequest(
            String code,
            String name,
            String description,
            String version,
            String icon,
            String route,
            int sortOrder,
            Map<String, Object> attributes
    ) {}

    @GetMapping
    @RequiresPermission(form = "platform.modules", action = "view")
    public ResponseEntity<List<InstalledModuleView>> getAllModules() {
        return ResponseEntity.ok(moduleService.getAllModules());
    }

    @GetMapping("/active")
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "view")
    public ResponseEntity<List<InstalledModuleView>> getActiveModules() {
        return ResponseEntity.ok(moduleService.getActiveModules());
    }

    @GetMapping("/{code}")
    @RequiresPermission(form = "platform.modules", action = "view")
    public ResponseEntity<InstalledModuleView> getModule(@PathVariable String code) {
        return moduleService.getModule(code)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/{code}/toggle")
    @RequiresPermission(form = "platform.modules", action = "manage")
    public ResponseEntity<InstalledModuleView> toggleModule(
            @PathVariable String code,
            @RequestBody(required = false) ToggleStatusRequest body,
            @RequestParam(required = false) Boolean active
    ) {
        boolean enabled = (body != null) ? body.enabled() : (active != null ? active : true);
        return ResponseEntity.ok(moduleService.toggleModuleStatus(code, enabled));
    }

    @PostMapping
    @RequiresPermission(form = "platform.modules", action = "manage")
    public ResponseEntity<InstalledModuleView> registerModule(
            @RequestBody RegisterModuleRequest body
    ) {
        return ResponseEntity.ok(moduleService.registerModule(
                body.code(), body.name(), body.description(),
                body.version(), body.icon(), body.route(),
                false, body.sortOrder(), body.attributes()
        ));
    }
}
