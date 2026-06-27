"use client";

import {useEffect} from "react";

const DARK_START_HOUR = 19; // 19:00 起进入夜间
const DARK_END_HOUR = 7; // 07:00 前保持夜间

const shouldUseDark = (now: Date) => {
  const hour = now.getHours();
  return hour >= DARK_START_HOUR || hour < DARK_END_HOUR;
};

const applyTheme = (isDark: boolean) => {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";
};

export default function ThemeClock() {
  useEffect(() => {
    const updateTheme = () => applyTheme(shouldUseDark(new Date()));

    updateTheme();
    const timer = window.setInterval(updateTheme, 5 * 60 * 1000); // 每 5 分钟校准一次

    return () => window.clearInterval(timer);
  }, []);

  return null;
}
