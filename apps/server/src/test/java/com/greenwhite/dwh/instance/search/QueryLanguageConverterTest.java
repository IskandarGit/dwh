package com.greenwhite.dwh.instance.search;

import com.greenwhite.dwh.instance.search.service.QueryLanguageConverter;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class QueryLanguageConverterTest {

    private final QueryLanguageConverter converter = new QueryLanguageConverter();

    @Test
    void convertsKeyboardLayoutBidirectionally() {
        // English to Russian layout
        assertThat(converter.convertLayout("ghjtrn")).isEqualTo("проект");
        assertThat(converter.convertLayout("pflfxf")).isEqualTo("задача");
        assertThat(converter.convertLayout("ntcn")).isEqualTo("тест");

        // Russian to English layout
        assertThat(converter.convertLayout("еуые")).isEqualTo("test");
        assertThat(converter.convertLayout("ефые")).isEqualTo("task");
        assertThat(converter.convertLayout("гыук")).isEqualTo("user");
    }

    @Test
    void transliteratesBetweenLatinAndCyrillic() {
        assertThat(converter.transliterate("proekt")).isEqualTo("проект");
        assertThat(converter.transliterate("shkola")).isEqualTo("школа");
        assertThat(converter.transliterate("zadacha")).isEqualTo("задача");
        assertThat(converter.transliterate("проект")).isEqualTo("proekt");
    }

    @Test
    void producesPhoneticSubstitutionsAndSoundex() {
        var expansion = converter.expand("tast");
        assertThat(expansion.variants()).contains("тест");

        // Soundex matching for tast and тест
        String soundexTast = converter.soundex("tast");
        String soundexTest = converter.soundex("тест");
        assertThat(soundexTast).isEqualTo("T230");
        assertThat(soundexTest).isEqualTo("Т230");
    }

    @Test
    void expandsQueryWithCorrectionSuggestion() {
        var ghjtrnExp = converter.expand("ghjtrn");
        assertThat(ghjtrnExp.variants()).contains("проект");
        assertThat(ghjtrnExp.suggestedCorrection()).isEqualTo("проект");

        var tastExp = converter.expand("tast");
        assertThat(tastExp.variants()).contains("тест");
        assertThat(tastExp.suggestedCorrection()).isEqualTo("тест");
    }
}
