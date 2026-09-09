package com.greenwhite.dwh.instance.fnd;

import com.greenwhite.dwh.instance.support.fixtures.DwhQualifierViolator;
import com.tngtech.archunit.core.domain.JavaClass;
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
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RestController;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
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

    @Test
    @DisplayName("AC-37: fnd не зависит от прикладных модулей upl/ref/reg/vit")
    void fndDependsOnNoApplicationModule() {
        noClasses().that().resideInAPackage(FND)
                .should().dependOnClassesThat()
                .resideInAnyPackage(ROOT + ".upl..", ROOT + ".ref..", ROOT + ".reg..", ROOT + ".vit..")
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
}
