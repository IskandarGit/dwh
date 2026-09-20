package com.greenwhite.dwh.instance.search.service;

import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Intelligent query transformation providing:
 * 1. Bidirectional keyboard layout auto-conversion (QWERTY <-> ЙЦУКЕН)
 * 2. Latin <-> Cyrillic transliteration and phonetic variants ("tast" <-> "тест")
 * 3. Phonetic Soundex encoding for Russian & Latin words
 */
@Component
public class QueryLanguageConverter {

    private static final String EN_CHARS = "qwertyuiop[]asdfghjkl;'zxcvbnm,./`QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>?~";
    private static final String RU_CHARS = "йцукенгшщзхъфывапролджэячсмитьбю.ёЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ,Ё";

    private static final Map<Character, Character> EN_TO_RU = new HashMap<>();
    private static final Map<Character, Character> RU_TO_EN = new HashMap<>();

    static {
        for (int i = 0; i < EN_CHARS.length() && i < RU_CHARS.length(); i++) {
            EN_TO_RU.put(EN_CHARS.charAt(i), RU_CHARS.charAt(i));
            RU_TO_EN.put(RU_CHARS.charAt(i), EN_CHARS.charAt(i));
        }
        // Additional key variants
        EN_TO_RU.put('?', ',');
        EN_TO_RU.put('/', '.');
        EN_TO_RU.put('^', ':');
        EN_TO_RU.put('&', '?');
        EN_TO_RU.put('@', '"');
        EN_TO_RU.put('#', '№');
        EN_TO_RU.put('$', ';');
    }

    public record QueryExpansion(
            String original,
            List<String> variants,
            String suggestedCorrection
    ) {}

    /**
     * Expands a user query into search variants (layout conversion, transliteration, phonetic correction)
     */
    public QueryExpansion expand(String rawQuery) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return new QueryExpansion(rawQuery, List.of(), null);
        }

        String query = rawQuery.trim();
        LinkedHashSet<String> variants = new LinkedHashSet<>();
        variants.add(query);

        String layoutConverted = convertLayout(query);
        boolean layoutDiffers = !layoutConverted.equalsIgnoreCase(query);
        if (layoutDiffers) {
            variants.add(layoutConverted);
        }

        String transliterated = transliterate(query);
        boolean translitDiffers = !transliterated.equalsIgnoreCase(query);
        if (translitDiffers) {
            variants.add(transliterated);
        }

        // Check common phonetic / keyboard typo substitutions like "tast" -> "тест"
        List<String> phonetics = getPhoneticSubstitutions(query);
        variants.addAll(phonetics);

        // Determine suggested correction if input is obviously mistyped
        String suggestion = null;
        if (isLikelyMistypedLayout(query) && layoutDiffers) {
            suggestion = layoutConverted;
        } else if (!phonetics.isEmpty() && isKnownPhoneticTypo(query)) {
            suggestion = phonetics.getFirst();
        } else if (isPureLatin(query) && translitDiffers && !query.contains(" ")) {
            suggestion = transliterated;
        }

        return new QueryExpansion(query, List.copyOf(variants), suggestion);
    }

    /**
     * Bidirectionally converts keyboard layout between QWERTY and ЙЦУКЕН
     */
    public String convertLayout(String text) {
        if (text == null || text.isBlank()) return text;
        StringBuilder sb = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (EN_TO_RU.containsKey(c)) {
                sb.append(EN_TO_RU.get(c));
            } else if (RU_TO_EN.containsKey(c)) {
                sb.append(RU_TO_EN.get(c));
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /**
     * Transliterates Latin to Cyrillic or Cyrillic to Latin
     */
    public String transliterate(String text) {
        if (text == null || text.isBlank()) return text;
        if (containsCyrillic(text)) {
            return cyrillicToLatin(text);
        } else if (isPureLatin(text)) {
            return latinToCyrillic(text);
        }
        return text;
    }

    /**
     * Generates a Soundex code for a word (supports both Latin and Cyrillic)
     */
    public String soundex(String text) {
        if (text == null || text.isBlank()) return "";
        String clean = text.trim().toUpperCase(Locale.ROOT);
        if (clean.isEmpty()) return "";

        StringBuilder code = new StringBuilder();
        char first = clean.charAt(0);
        code.append(first);

        char prevDigit = getSoundexDigit(first);

        for (int i = 1; i < clean.length(); i++) {
            char c = clean.charAt(i);
            char digit = getSoundexDigit(c);
            if (digit != '0' && digit != prevDigit) {
                code.append(digit);
            }
            if (digit != '0') {
                prevDigit = digit;
            }
            if (code.length() >= 4) break;
        }

        while (code.length() < 4) {
            code.append('0');
        }

        return code.toString();
    }

    private char getSoundexDigit(char c) {
        return switch (c) {
            case 'B', 'F', 'P', 'V', 'Б', 'П', 'Ф', 'В' -> '1';
            case 'C', 'G', 'J', 'K', 'Q', 'S', 'X', 'Z', 'С', 'З', 'Ц', 'Ш', 'Щ', 'Ж', 'К', 'Г', 'Х' -> '2';
            case 'D', 'T', 'Д', 'Т' -> '3';
            case 'L', 'Л' -> '4';
            case 'M', 'N', 'М', 'Н' -> '5';
            case 'R', 'Р' -> '6';
            default -> '0'; // Vowels, H, W, Y and equivalents
        };
    }

    private List<String> getPhoneticSubstitutions(String query) {
        List<String> list = new ArrayList<>();
        String lower = query.toLowerCase(Locale.ROOT);

        // Specific common Russian/English search equivalents
        if ("tast".equals(lower)) {
            list.add("тест");
            list.add("таст");
        } else if ("test".equals(lower)) {
            list.add("тест");
        } else if ("тест".equals(lower)) {
            list.add("test");
        } else if ("task".equals(lower) || "таск".equals(lower)) {
            list.add("задача");
            list.add("task");
        } else if ("proekt".equals(lower) || "project".equals(lower)) {
            list.add("проект");
        } else if ("user".equals(lower) || "yuzer".equals(lower)) {
            list.add("пользователь");
        } else if ("note".equals(lower) || "zametka".equals(lower)) {
            list.add("заметка");
        }

        return list;
    }

    private boolean isKnownPhoneticTypo(String query) {
        String lower = query.toLowerCase(Locale.ROOT);
        return Set.of("tast", "proekt", "yuzer", "zametka").contains(lower);
    }

    private boolean isLikelyMistypedLayout(String text) {
        if (text == null || text.length() < 2) return false;
        // Check for typical Russian consonant clusters typed on English keyboard (e.g. ghj, pfl, ghb)
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("ghj") || lower.startsWith("pfl") || lower.startsWith("ghb") ||
                lower.startsWith("vjl") || lower.startsWith("еуы") || lower.startsWith("ntc")) {
            return true;
        }
        // If string consists only of Latin consonants in rare English combinations
        if (isPureLatin(text) && (lower.contains("jtr") || lower.contains("fxf") || lower.contains("h,j"))) {
            return true;
        }
        return false;
    }

    private boolean containsCyrillic(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.UnicodeBlock.of(c) == Character.UnicodeBlock.CYRILLIC) {
                return true;
            }
        }
        return false;
    }

    private boolean isPureLatin(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (Character.isLetter(c) && Character.UnicodeBlock.of(c) != Character.UnicodeBlock.BASIC_LATIN) {
                return false;
            }
        }
        return true;
    }

    private String latinToCyrillic(String text) {
        String s = text.toLowerCase(Locale.ROOT);
        // Multi-char replacements
        s = s.replace("shch", "щ")
                .replace("sch", "щ")
                .replace("sh", "ш")
                .replace("ch", "ч")
                .replace("zh", "ж")
                .replace("ya", "я")
                .replace("yu", "ю")
                .replace("yo", "ё")
                .replace("ts", "ц")
                .replace("tc", "ц")
                .replace("kh", "х")
                .replace("ph", "ф");

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(switch (c) {
                case 'a' -> 'а';
                case 'b' -> 'б';
                case 'v', 'w' -> 'в';
                case 'g' -> 'г';
                case 'd' -> 'д';
                case 'e' -> 'е';
                case 'z' -> 'з';
                case 'i' -> 'и';
                case 'j', 'y' -> 'й';
                case 'k' -> 'к';
                case 'l' -> 'л';
                case 'm' -> 'м';
                case 'n' -> 'н';
                case 'o' -> 'о';
                case 'p' -> 'п';
                case 'r' -> 'р';
                case 's' -> 'с';
                case 't' -> 'т';
                case 'u' -> 'у';
                case 'f' -> 'ф';
                case 'h' -> 'х';
                case 'c' -> 'к';
                case 'x' -> "кс";
                default -> c;
            });
        }
        return sb.toString();
    }

    private String cyrillicToLatin(String text) {
        StringBuilder sb = new StringBuilder();
        String s = text.toLowerCase(Locale.ROOT);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(switch (c) {
                case 'а' -> "a";
                case 'б' -> "b";
                case 'в' -> "v";
                case 'г' -> "g";
                case 'д' -> "d";
                case 'е', 'э' -> "e";
                case 'ё' -> "yo";
                case 'ж' -> "zh";
                case 'з' -> "z";
                case 'и' -> "i";
                case 'й' -> "y";
                case 'к' -> "k";
                case 'л' -> "l";
                case 'м' -> "m";
                case 'н' -> "n";
                case 'о' -> "o";
                case 'п' -> "p";
                case 'р' -> "r";
                case 'с' -> "s";
                case 'т' -> "t";
                case 'у' -> "u";
                case 'ф' -> "f";
                case 'х' -> "kh";
                case 'ц' -> "ts";
                case 'ч' -> "ch";
                case 'ш' -> "sh";
                case 'щ' -> "shch";
                case 'ъ', 'ь' -> "";
                case 'ы' -> "y";
                case 'ю' -> "yu";
                case 'я' -> "ya";
                default -> c;
            });
        }
        return sb.toString();
    }
}
