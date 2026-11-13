package ru.lounge1708.evotorbridge;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Small native UI kit for the terminal's narrow portrait display. */
final class DeskUi {
    static final int INK = Color.rgb(28, 40, 50), MUTED = Color.rgb(84, 99, 111), PAPER = Color.rgb(244, 246, 248);
    static final int AMBER = Color.rgb(255, 178, 36), LINE = Color.rgb(212, 220, 226), GREEN = Color.rgb(24, 105, 74), RED = Color.rgb(158, 44, 36);
    private final Activity activity;
    DeskUi(Activity activity) { this.activity = activity; }
    int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }
    LinearLayout column() { LinearLayout view = new LinearLayout(activity); view.setOrientation(LinearLayout.VERTICAL); return view; }
    LinearLayout row(LinearLayout parent) {
        LinearLayout row = new LinearLayout(activity); row.setGravity(Gravity.CENTER_VERTICAL); parent.addView(row, new LinearLayout.LayoutParams(-1, -2)); return row;
    }
    TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(activity); view.setText(value); view.setTextSize(size); view.setTextColor(INK);
        view.setPadding(0, dp(5), 0, dp(5)); view.setLineSpacing(dp(2), 1); parent.addView(view); return view;
    }
    GradientDrawable background(int color, int border) {
        GradientDrawable shape = new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(8));
        if (border != 0) shape.setStroke(dp(1), border); return shape;
    }
    Button button(LinearLayout parent, String label, Runnable action) {
        Button button = new Button(activity); button.setText(label); button.setTextSize(16); button.setAllCaps(false); button.setMinHeight(dp(52));
        button.setMinWidth(0); button.setMinimumWidth(0); button.setPadding(dp(10), dp(8), dp(10), dp(8));
        button.setBackgroundTintList(null); button.setBackground(background(Color.WHITE, LINE));
        button.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled}, new int[]{}}, new int[]{MUTED, INK}));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(6); parent.addView(button, params);
        button.setOnClickListener(v -> action.run()); return button;
    }
    void primary(Button button) { button.setBackground(background(AMBER, 0)); button.setTypeface(null, Typeface.BOLD); }
    void weighted(View view) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1); params.setMargins(dp(2), dp(3), dp(2), dp(3)); view.setLayoutParams(params);
    }
    TextView heading(LinearLayout parent, String label, int size) { TextView view = text(parent, label, size); view.setTypeface(null, Typeface.BOLD); return view; }
    LinearLayout card(LinearLayout parent) {
        LinearLayout card = column(); card.setPadding(dp(14), dp(10), dp(14), dp(10)); card.setBackground(background(Color.WHITE, LINE));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(10); parent.addView(card, params); return card;
    }
}
