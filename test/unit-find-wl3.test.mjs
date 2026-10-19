import { defineWl } from './unit-find-wl-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(系列條件白名單, dspec〈一之三〉; 本套件 cvOrmFind({ maxIn: 2000, maxList: 999 }))
//本檔: wsemi 案例表(255案)之第 3/4 份(案例序號 mod 4 = 2), 逐案對公開 select/delAll; 斷言見 unit-find-wl-setup.mjs 之 runWl
defineWl(2, 4)
