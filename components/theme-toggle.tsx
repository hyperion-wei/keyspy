"use client"

import * as React from "react"
import {Laptop, Moon, Sun} from "lucide-react"
import {useTheme} from "next-themes"
import {Button} from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()
  const mounted = React.useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  )

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" className="h-9 w-9 rounded-full border-border/40 bg-background/60 backdrop-blur-sm">
        <span className="sr-only">Toggle theme</span>
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => {
        if (theme === 'light') setTheme('dark')
        else if (theme === 'dark') setTheme('system')
        else setTheme('light')
      }}
      className="h-9 w-9 rounded-full border-border/40 bg-background/60 backdrop-blur-sm hover:bg-background/80 transition-all"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      {theme === 'system' && (
        <Laptop className="absolute h-[0.8rem] w-[0.8rem] translate-y-2 translate-x-2 opacity-50" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
