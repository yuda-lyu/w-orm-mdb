import { defineWf } from './unit-wf-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WF(字串良構檢核, dspec〈一之三〉9., 第66項批2; 本套件接 wsemi 之 chkOrmStr 與 chkOrmData)
//本檔: wsemi 案例表(_cvOrmStrCases, API 層)之第 1/6 份(工作序號 mod 6 = 0), 逐案對公開 API; 斷言見 unit-wf-setup.mjs 之 runCase
defineWf(0)
