package com.greenwhite.dwh.instance.architecture;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.stereotype.Repository;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RestController;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
import static org.assertj.core.api.Assertions.assertThat;

class ModularArchitectureTest {

    private static JavaClasses importedClasses;

    @BeforeAll
    static void setup() {
        importedClasses = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages("com.greenwhite.dwh.instance");
    }

    @Test
    @DisplayName("0. Архитектурный анализ должен импортировать классы приложения")
    void architectureAnalysisShouldImportApplicationClasses() {
        assertThat(importedClasses.stream()
                .map(JavaClass::getName)
                .toList())
                .contains("com.greenwhite.dwh.instance.InstanceApplication");
    }

    @Test
    @DisplayName("1. Модули ядра (md, kauth, ms, mf, audit, kwh, search) не должны иметь циклических зависимостей (DAG)")
    void modulesShouldBeFreeOfCycles() {
        slices().matching("com.greenwhite.dwh.instance.(*)..")
                .should().beFreeOfCycles()
                .check(importedClasses);
    }

    @Test
    @DisplayName("2. Контроллеры не должны напрямую обращаться к репозиториям (только через сервисный слой)")
    void controllersShouldNotAccessRepositoriesDirectly() {
        controllerRepositoryAccessRule().check(importedClasses);
    }

    private static ArchRule controllerRepositoryAccessRule() {
        // Spring's CSRF token contract is HTTP security, not application data access.
        return noClasses()
                .that().haveSimpleNameEndingWith("Controller")
                .should().dependOnClassesThat(JavaClass.Predicates.simpleNameEndingWith("Repository")
                        .and(com.tngtech.archunit.base.DescribedPredicate.not(JavaClass.Predicates.equivalentTo(
                                org.springframework.security.web.csrf.CsrfTokenRepository.class))));
    }

    @Test
    void controllerRepositoryRuleAllowsSpringCsrfCookieInterface() {
        controllerRepositoryAccessRule().check(new ClassFileImporter().importClasses(CsrfCookieController.class));
    }

    @Test
    void controllerRepositoryRuleStillRejectsApplicationDataAccess() {
        assertRepositoryDependencyRejected(DataAccessController.class,
                "com.greenwhite.dwh.instance.md.repository.MdUserRepository");
    }

    @Test
    void controllerRepositoryRuleDoesNotExemptSameSimpleName() {
        assertRepositoryDependencyRejected(SameNameController.class, CsrfTokenRepository.class.getName());
    }

    @Test
    void controllerRepositoryRuleDoesNotExemptOtherSpringCsrfRepositories() {
        assertRepositoryDependencyRejected(OtherSpringCsrfController.class,
                "org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository");
    }

    private static void assertRepositoryDependencyRejected(Class<?> controller, String repositoryName) {
        var result = controllerRepositoryAccessRule().evaluate(new ClassFileImporter().importClasses(controller));
        assertThat(result.hasViolation()).isTrue();
        assertThat(result.getFailureReport().getDetails()).anyMatch(detail -> detail.contains(repositoryName));
    }

    @Test
    @DisplayName("3. Репозитории не должны зависеть от сервисов (чистота слоя данных)")
    void repositoriesShouldNotDependOnServices() {
        noClasses()
                .that().haveSimpleNameEndingWith("Repository")
                .should().dependOnClassesThat().haveSimpleNameEndingWith("Service")
                .check(importedClasses);
    }

    @Test
    @DisplayName("4. Модуль мастер-данных (md) не должен зависеть от прикладного модуля задач (ms)")
    void masterDataModuleShouldNotDependOnTasksModule() {
        noClasses()
                .that().resideInAPackage("com.greenwhite.dwh.instance.md..")
                .should().dependOnClassesThat().resideInAPackage("com.greenwhite.dwh.instance.ms..")
                .check(importedClasses);
    }




    @Test
    @DisplayName("5. Модуль файлового хранилища (mf) не должен зависеть от прикладного модуля задач (ms)")
    void fileStorageModuleShouldNotDependOnTasksModule() {
        noClasses()
                .that().resideInAPackage("com.greenwhite.dwh.instance.mf..")
                .should().dependOnClassesThat().resideInAPackage("com.greenwhite.dwh.instance.ms..")
                .check(importedClasses);
    }

    @Test
    @DisplayName("6. Все REST контроллеры должны быть аннотированы @RestController")
    void controllersShouldBeAnnotatedWithRestController() {
        classes()
                .that().haveSimpleNameEndingWith("Controller")
                .should().beAnnotatedWith(RestController.class)
                .check(importedClasses);
    }

    @Test
    @DisplayName("7. Все сервисы должны быть аннотированы @Service")
    void servicesShouldBeAnnotatedWithService() {
        classes()
                .that().haveSimpleNameEndingWith("Service")
                .and().areNotInterfaces()
                .should().beAnnotatedWith(Service.class)
                .check(importedClasses);
    }

    @Test
    @DisplayName("8. Все репозитории должны быть аннотированы @Repository")
    void repositoriesShouldBeAnnotatedWithRepository() {
        classes()
                .that().haveSimpleNameEndingWith("Repository")
                .and().areNotInterfaces()
                .should().beAnnotatedWith(Repository.class)
                .check(importedClasses);
    }

    @Test
    @DisplayName("9. Модуль аутентификации (kauth) не должен напрямую зависеть от репозиториев мастер-данных (md), кроме адаптера KauthUserSessionInvalidator")
    void kauthShouldNotDependOnMdRepositoriesDirectly() {
        noClasses()
                .that().resideInAPackage("com.greenwhite.dwh.instance.kauth..")
                .and().doNotHaveSimpleName("KauthUserSessionInvalidator")
                .should().dependOnClassesThat(
                        JavaClass.Predicates.resideInAPackage("com.greenwhite.dwh.instance.md.repository..")
                                .and(JavaClass.Predicates.simpleNameEndingWith("Repository")))
                .check(importedClasses);
    }

    @Test
    @DisplayName("10. Модуль задач (ms.task) не должен напрямую зависеть от репозиториев уведомлений (ms.notify)")
    void taskModuleShouldNotDependOnNotifyRepositoriesDirectly() {
        noClasses()
                .that().resideInAPackage("com.greenwhite.dwh.instance.ms.task..")
                .should().dependOnClassesThat(
                        JavaClass.Predicates.resideInAPackage("com.greenwhite.dwh.instance.ms.notify.repository..")
                                .and(JavaClass.Predicates.simpleNameEndingWith("Repository")))
                .check(importedClasses);
    }

    @Test
    @DisplayName("11. Правило запрета доступа к чужим репозиториям корректно выявляет нарушения")
    void foreignRepositoryRuleRejectsDirectAccess() {
        var rule = noClasses().should().dependOnClassesThat(
                JavaClass.Predicates.resideInAPackage("com.greenwhite.dwh.instance.md.repository..")
                        .and(JavaClass.Predicates.simpleNameEndingWith("Repository")));
        var result = rule.evaluate(new ClassFileImporter().importClasses(FakeRepositoryConsumer.class));
        assertThat(result.hasViolation()).isTrue();
        assertThat(result.getFailureReport().getDetails())
                .anyMatch(detail -> detail.contains("com.greenwhite.dwh.instance.md.repository.MdUserRepository"));
    }

    private static class FakeRepositoryConsumer {
        private final com.greenwhite.dwh.instance.md.repository.MdUserRepository users;
        FakeRepositoryConsumer(com.greenwhite.dwh.instance.md.repository.MdUserRepository users) {
            this.users = users;
        }
    }

    private static class CsrfCookieController {
        private final org.springframework.security.web.csrf.CsrfTokenRepository cookies;
        CsrfCookieController(org.springframework.security.web.csrf.CsrfTokenRepository cookies) {
            this.cookies = cookies;
        }
    }

    private static class DataAccessController {
        private final com.greenwhite.dwh.instance.md.repository.MdUserRepository users;
        DataAccessController(com.greenwhite.dwh.instance.md.repository.MdUserRepository users) {
            this.users = users;
        }
    }

    private interface CsrfTokenRepository {}

    private static class SameNameController {
        private final CsrfTokenRepository repository;
        SameNameController(CsrfTokenRepository repository) {
            this.repository = repository;
        }
    }

    private static class OtherSpringCsrfController {
        private final org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository repository;
        OtherSpringCsrfController(org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository repository) {
            this.repository = repository;
        }
    }
}
