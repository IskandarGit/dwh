package com.greenwhite.dwh.instance.md.controller;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.md.pref.MdPref;
import com.greenwhite.dwh.instance.md.service.NavigationItemService;
import com.greenwhite.dwh.instance.md.service.NavigationItemService.CreateNavigationItemCommand;
import com.greenwhite.dwh.instance.md.service.NavigationItemService.NavigationItemView;
import com.greenwhite.dwh.instance.md.service.NavigationItemService.UpdateNavigationItemCommand;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/navigation/items")
public class NavigationItemController {

    private final NavigationItemService navigationService;

    public NavigationItemController(NavigationItemService navigationService) {
        this.navigationService = navigationService;
    }

    @GetMapping("/active")
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "view")
    public ResponseEntity<List<NavigationItemView>> getActiveItems() {
        return ResponseEntity.ok(navigationService.getActiveItems());
    }

    @GetMapping
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "view")
    public ResponseEntity<List<NavigationItemView>> getAllItems() {
        return ResponseEntity.ok(navigationService.getAllItems());
    }

    @GetMapping("/{id}")
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "view")
    public ResponseEntity<NavigationItemView> getItem(@PathVariable Long id) {
        return navigationService.getItemById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/by-code/{code}")
    @RequiresPermission(form = MdPref.FORM_PROFILE, action = "view")
    public ResponseEntity<NavigationItemView> getItemByCode(@PathVariable String code) {
        return navigationService.getItemByCode(code)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "manage")
    public ResponseEntity<NavigationItemView> createItem(@Valid @RequestBody CreateNavigationItemCommand cmd) {
        Long userId = SecurityContext.getCurrentUserId();
        NavigationItemView created = navigationService.createItem(cmd, userId);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/{id}")
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "manage")
    public ResponseEntity<NavigationItemView> updateItem(@PathVariable Long id, @Valid @RequestBody UpdateNavigationItemCommand cmd) {
        Long userId = SecurityContext.getCurrentUserId();
        return ResponseEntity.ok(navigationService.updateItem(id, cmd, userId));
    }

    @PostMapping("/{id}/toggle")
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "manage")
    public ResponseEntity<NavigationItemView> toggleItem(@PathVariable Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        return ResponseEntity.ok(navigationService.toggleState(id, userId));
    }

    @DeleteMapping("/{id}")
    @RequiresPermission(form = MdPref.FORM_NAVIGATION, action = "manage")
    public ResponseEntity<Void> deleteItem(@PathVariable Long id) {
        Long userId = SecurityContext.getCurrentUserId();
        navigationService.deleteItem(id, userId);
        return ResponseEntity.noContent().build();
    }
}
