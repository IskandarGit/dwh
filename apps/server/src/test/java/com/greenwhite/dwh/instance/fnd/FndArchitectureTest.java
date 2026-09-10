package com.greenwhite.dwh.instance.fnd;

import com.greenwhite.dwh.instance.fnd.fixtures.FndDependsOnUplViolator;
import com.greenwhite.dwh.instance.fnd.fixtures.FndScheduledViolator;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.fixtures.DwhQualifierViolator;
import com.greenwhite.dwh.instance.upl.fixtures.UplModuleFixture;
import com.greenwhite.dwh.spi.storage.StorageProvider;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaCall;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaCodeUnit;
import com.tngtech.archunit.core.domain.JavaField;
import com.tngtech.archunit.core.domain.JavaParameter;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.EvaluationResult;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RestController;

import static com.tngtech.archunit.core.domain.JavaClass.Predicates.assignableTo;
import static com.tngtech.archunit.core.domain.properties.HasName.Predicates.name;
import static com.tngtech.archunit.core.domain.properties.HasOwner.Predicates.With.owner;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noMethods;
import static org.assertj.core.api.Assertions.assertThat;

/** Правила основы (18 п.11, п.13–14): AC-5, AC-37, AC-42. Без Spring и базы. */
class FndArchitectureTest {

    private static final String ROOT = "com.greenwhite.dwh.instance";
    private static final String FND = ROOT + ".fnd..";
    private static JavaClasses main;

    @BeforeAll
    static void importClasses() {
        main = new ClassFileImporter()
                .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                .importPackages(ROOT);
        if (main.isEmpty()) {
            throw new IllegalStateException("Классы приложения не импортированы — проверьте версию ArchUnit");
        }
    }

    /** AC-5: квалификатор {@code "dwh"} — только в полях и параметрах классов пакета fnd. */
    static ArchRule dwhQualifierOnlyInFnd() {
        return classes().should(new ArchCondition<>("use @Qualifier(\"dwh\") only inside " + FND) {
            @Override
            public void check(JavaClass type, ConditionEvents events) {
                boolean inFnd = type.getPackageName().startsWith(ROOT + ".fnd");
                for (JavaField field : type.getFields()) {
                    if (isDwh(field.tryGetAnnotationOfType(Qualifier.class).orElse(null))) {
                        events.add(new SimpleConditionEvent(type, inFnd,
                                field.getFullName() + " объявляет @Qualifier(\"dwh\") вне пакета fnd"));
                    }
                }
                for (JavaCodeUnit unit : type.getCodeUnits()) {
                    for (JavaParameter parameter : unit.getParameters()) {
                        if (isDwh(parameter.tryGetAnnotationOfType(Qualifier.class).orElse(null))) {
                            events.add(new SimpleConditionEvent(type, inFnd,
                                    unit.getFullName() + " принимает @Qualifier(\"dwh\") вне пакета fnd"));
                        }
                    }
                }
            }

            private boolean isDwh(Qualifier qualifier) {
                return qualifier != null && FndPref.DWH.equals(qualifier.value());
            }
        });
    }

    @Test
    @DisplayName("AC-5: бины pg-dwh (@Qualifier(\"dwh\")) используются только в ..instance.fnd..")
    void dwhQualifierStaysInFnd() {
        dwhQualifierOnlyInFnd().check(main);
    }

    @Test
    @DisplayName("AC-5: фикстура-нарушитель вне fnd делает правило красным")
    void dwhQualifierViolatorIsRed() {
        JavaClasses withViolator = new ClassFileImporter().importClasses(DwhQualifierViolator.class);
        EvaluationResult result = dwhQualifierOnlyInFnd().evaluate(withViolator);
        assertThat(result.hasViolation()).isTrue();
        assertThat(result.getFailureReport().toString()).contains("DwhQualifierViolator");
    }

    /** AC-37: основа не знает прикладных модулей; платформенные модули каркаса (common, config, kauth, md, mf, audit) — можно. */
    static ArchRule fndDependsOnNoApplicationModuleRule() {
        return noClasses().that().resideInAPackage(FND)
                .should().dependOnClassesThat()
                .resideInAnyPackage(ROOT + ".upl..", ROOT + ".ref..", ROOT + ".reg..", ROOT + ".vit..");
    }

    @Test
    @DisplayName("AC-37: fnd не зависит от прикладных модулей upl/ref/reg/vit")
    void fndDependsOnNoApplicationModule() {
        fndDependsOnNoApplicationModuleRule().check(main);
    }

    @Test
    @DisplayName("AC-37: фикстура-нарушитель в fnd, импортирующая upl, делает правило красным")
    void fndDependingOnUplIsRed() {
        JavaClasses withViolator = new ClassFileImporter()
                .importClasses(FndDependsOnUplViolator.class, UplModuleFixture.class);
        EvaluationResult result = fndDependsOnNoApplicationModuleRule().evaluate(withViolator);
        assertThat(result.hasViolation()).isTrue();
        assertThat(result.getFailureReport().toString()).contains("FndDependsOnUplViolator").contains("UplModuleFixture");
    }

    /** AC-8: файлы хранит модуль mf каркаса — своего хранилища и обращений к SPI в основе нет. */
    @Test
    @DisplayName("AC-8: в fnd нет своего FileStorage и зависимости от StorageProvider")
    void fndHasNoOwnFileStorage() {
        noClasses().that().resideInAPackage(FND)
                .should().haveSimpleNameContaining("FileStorage")
                .orShould().dependOnClassesThat().areAssignableTo(StorageProvider.class)
                .check(main);
    }

    /** AC-8: fnd не вызывает удаление файла — исходный файл загрузки неизменяем (13 инв.4). */
    @Test
    @DisplayName("AC-8: fnd не вызывает удаление файла в модуле mf")
    void fndNeverDeletesFiles() {
        noClasses().that().resideInAPackage(FND)
                .should().callMethodWhere(JavaCall.Predicates.target(owner(assignableTo(MfFileService.class)))
                        .and(JavaCall.Predicates.target(name("deleteFile"))))
                .check(main);
    }

    @Test
    @DisplayName("AC-42: в fnd нет контроллеров и эндпоинтов")
    void fndHasNoControllers() {
        noClasses().that().resideInAPackage(FND)
                .should().beAnnotatedWith(RestController.class)
                .orShould().beAnnotatedWith(Controller.class)
                .check(main);
    }

    /** AC-7: планировщика в основе нет — момент запуска заданий выбирает экземпляр; воркеры каркаса правило не трогает. */
    static ArchRule noScheduledInFndRule() {
        return noMethods().that().areDeclaredInClassesThat().resideInAPackage(FND)
                .should().beAnnotatedWith(Scheduled.class);
    }

    @Test
    @DisplayName("AC-7: @Scheduled отсутствует в ..instance.fnd.. (в модулях каркаса — есть, правило их не касается)")
    void fndHasNoScheduled() {
        noScheduledInFndRule().check(main);
        // Контроль, что правило действительно узкое: у каркаса @Scheduled есть, и импорт его видит
        boolean frameworkHasScheduled = main.stream()
                .filter(type -> !type.getPackageName().startsWith(ROOT + ".fnd"))
                .flatMap(type -> type.getMethods().stream())
                .anyMatch(method -> method.isAnnotatedWith(Scheduled.class));
        assertThat(frameworkHasScheduled).as("в модулях каркаса есть @Scheduled").isTrue();
    }

    @Test
    @DisplayName("AC-7: фикстура-нарушитель с @Scheduled в fnd делает правило красным")
    void fndScheduledViolatorIsRed() {
        JavaClasses withViolator = new ClassFileImporter().importClasses(FndScheduledViolator.class);
        EvaluationResult result = noScheduledInFndRule().evaluate(withViolator);
        assertThat(result.hasViolation()).isTrue();
        assertThat(result.getFailureReport().toString()).contains("FndScheduledViolator");
    }
}
