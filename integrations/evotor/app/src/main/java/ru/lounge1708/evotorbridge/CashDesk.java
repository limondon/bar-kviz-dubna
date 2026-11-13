package ru.lounge1708.evotorbridge;

import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/** Presentation only: filtering never changes the bill, payment state or source date. */
final class CashDesk {
    static final int ALL = 0, NEW = 1, SAVED = 2, ATTENTION = 3;
    private static final TimeZone ZONE = TimeZone.getTimeZone("Europe/Moscow");
    static String date(long now, int offset) {
        Calendar calendar = Calendar.getInstance(ZONE); calendar.setTimeInMillis(now); calendar.add(Calendar.DATE, offset);
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT); format.setTimeZone(ZONE);
        return format.format(calendar.getTime());
    }
    static List<String> dates(String selected, long now) {
        List<String> dates = new ArrayList<>();
        if (selected != null) { parseDate(selected); dates.add(selected); }
        else { dates.add(date(now, 0)); dates.add(date(now, -1)); }
        return dates;
    }
    static Date parseDate(String value) {
        try {
            if (value == null || !value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) throw new IllegalArgumentException();
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT); format.setLenient(false); format.setTimeZone(ZONE);
            return format.parse(value);
        } catch (Exception e) { throw new IllegalArgumentException("Выберите существующую дату."); }
    }
    static String dayLabel(String date, long now) {
        if (date.equals(date(now, 0))) return "Сегодня";
        if (date.equals(date(now, -1))) return "Вчера";
        parseDate(date); return date.substring(8, 10) + "." + date.substring(5, 7) + "." + date.substring(0, 4);
    }
    static String money(long kopecks) {
        DecimalFormat format = new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(new Locale("ru", "RU")));
        return format.format(BigDecimal.valueOf(kopecks, 2)) + " ₽";
    }
    static int group(CashBill bill, long now) {
        String state = bill.record.optString("state");
        if ("opened".equals(state) || ("cleared".equals(state) && "postponed".equals(bill.record.optString("recoveryKind")))) return SAVED;
        if ("queued".equals(state) && !bill.record.optBoolean("needsRefresh") && bill.isFresh(now)) return NEW;
        return ATTENTION;
    }
    static String state(CashBill bill, long now) {
        String state = bill.record.optString("state");
        if ("opened".equals(state)) return "Ранее открыт · проверить состояние";
        if ("cleared".equals(state) && "postponed".equals(bill.record.optString("recoveryKind"))) return "Отложен · проверить и продолжить";
        if ("queued".equals(state) && !bill.record.optBoolean("needsRefresh") && bill.isFresh(now)) return "Готов к проверке";
        if ("queued".equals(state) && !bill.record.optBoolean("needsRefresh")) return "Снимок устарел · проверьте свежесть";
        if ("queued".equals(state) || "cleared".equals(state)) return "Обновите состав на сайте";
        if ("opening".equals(state)) return "Открытие выполняется · повтор недоступен";
        if ("rejected".equals(state)) return "Открытие отклонено · проверьте кассу";
        return "Результат неизвестен · проверьте кассу";
    }
    static boolean matches(CashBill bill, int filter, String query, long now) {
        if (filter != ALL && filter != group(bill, now)) return false;
        String key = normalize(query);
        if (key.isEmpty()) return true;
        if (normalize("Стол " + bill.table).contains(key)) return true;
        for (CashBill.Line line : bill.lines) if (normalize(line.name).contains(key)) return true;
        return false;
    }
    private static String normalize(String value) { return value.trim().toLowerCase(Locale.ROOT).replace('ё', 'е'); }
    static int compare(CashBill left, CashBill right) {
        int byDay = right.date.compareTo(left.date);
        if (byDay != 0) return byDay;
        if (left.table.matches("[0-9]+") && right.table.matches("[0-9]+")) {
            int numeric = new java.math.BigInteger(left.table).compareTo(new java.math.BigInteger(right.table));
            if (numeric != 0) return numeric;
        }
        int byTable = left.table.compareToIgnoreCase(right.table);
        if (byTable != 0) return byTable;
        int byTime = Long.compare(right.record.optLong("createdAt"), left.record.optLong("createdAt"));
        return byTime != 0 ? byTime : left.id.compareTo(right.id);
    }
    static String contents(CashBill bill) {
        Set<String> names = new LinkedHashSet<>(); for (CashBill.Line line : bill.lines) names.add(line.name);
        StringBuilder summary = new StringBuilder(); int shown = 0;
        for (String name : names) { if (shown++ == 3) break; if (summary.length() > 0) summary.append(", "); summary.append(name); }
        if (names.size() > 3) summary.append(" и ещё ").append(names.size() - 3);
        return summary.toString();
    }
}
