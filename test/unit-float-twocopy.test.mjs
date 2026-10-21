import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { createRequire } from 'module'
import { isWindows } from './unit-setup.mjs'


//spec: CLAUDE_rulebook.md之R-FLOAT-00(DATE欄之判定兩側同用reladb之getColKind, 以type.key補判, 不倚賴instanceof)、R-FIND LF1(兩份sequelize並存)
//本檔: 重複安裝佈局——reladb帶自己的巢狀sequelize副本(模組身分不同於本套件解析到的那份, 如npm link、pnpm、各repo並排),
//  於該佈局下DATE欄仍須被辨識為date, 兩側換算一致(負偏移時區哨兵不誤命中, 多DATE欄、Date/epoch條件皆正確)
//  修前(dateNoTz:'local')不受此軸影響; 修後若有人把分類改為instanceof則單一佈局全綠而此佈局紅(變異R5)
//註: 佈局建於test/_tmp/float-twocopy/(測完即刪), 子行程跑probe並輸出JSON; 子行程內以process.env.TZ執行期切換時區


let nm = 'float-twocopy'

//套件目錄: 由解析結果取得(測試可能被複製到副本夾執行, 副本夾無自己的node_modules而向上解析)
const req = createRequire(import.meta.url)
const dirOf = (name) => path.dirname(req.resolve(`${name}/package.json`))
let fdTmp = `./test/_tmp/${nm}`

const PROBE = `
import Sequelize from 'sequelize'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'
import { queryMemory } from './src/queryMemory.mjs'

let here = path.dirname(fileURLToPath(import.meta.url))
let reqRl = createRequire(path.join(here, 'node_modules', 'w-orm-reladb', 'src', 'cvFind.mjs'))
let SequelizeRl = reqRl('sequelize')
let { getColKind } = await import('w-orm-reladb/src/cvFind.mjs')

let out = {
    sameClass: Sequelize === SequelizeRl,
    sameDate: Sequelize.DATE === SequelizeRl.DATE,
    kindDate: getColKind({ d: { type: Sequelize.DATE } }, 'd'),
    kindDateOnly: getColKind({ d: { type: Sequelize.DATEONLY } }, 'd'),
    kindStr: getColKind({ d: { type: Sequelize.STRING } }, 'd'),
}

const opt = { cl: 'tfloat', logging: false }
const attrs = { id: { type: Sequelize.STRING }, d: { type: Sequelize.DATE }, d2: { type: Sequelize.DATE } }
const rows = [
    { id: 'expired', d: '2020-01-01T00:00:00', d2: '9999-12-31T23:59:59' },
    { id: 'never', d: '9999-12-31T23:59:59', d2: '2020-01-01T00:00:00' },
    { id: 'future', d: '2099-01-01T00:00:00', d2: null },
]
const ids = async (find) => (await queryMemory(opt, attrs, rows, find)).map((v) => v.id).sort()
const att = async (fn) => {
    try {
        return await fn()
    }
    catch (e) {
        return 'REJECT ' + String((e && e.message) || e).slice(0, 120)
    }
}

out.tz = {}
for (let tz of ['America/Los_Angeles', 'Asia/Taipei', 'Etc/GMT+12']) {
    process.env.TZ = tz
    let local = (y, mo, d, h, mi, s) => {
        let t = new Date(2000, 0, 1, 0, 0, 0, 0)
        t.setFullYear(y, mo - 1, d)
        t.setHours(h, mi, s, 0)
        return t
    }
    out.tz[tz] = {
        offsetWinter: new Date(2026, 0, 15).getTimezoneOffset(),
        lt: await att(() => ids({ d: { $lt: '2026-10-20T00:00:00' } })),
        ltDate: await att(() => ids({ d: { $lt: local(2026, 10, 20, 0, 0, 0) } })),
        ltEpoch: await att(() => ids({ d: { $lt: local(2026, 10, 20, 0, 0, 0).getTime() } })),
        sentinelStr: await att(() => ids({ d: { $gte: '9999-12-31T23:59:59' } })),
        sentinelDate: await att(() => ids({ d: { $gte: local(9999, 12, 31, 23, 59, 59) } })),
        d2lt: await att(() => ids({ d2: { $lt: '2026-10-20T00:00:00' } })),
        d2gte: await att(() => ids({ d2: { $gte: '9999-12-31T23:59:59' } })),
        both: await att(() => ids({ $and: [{ d: { $lt: '2099-01-01T00:00:00' } }, { d2: { $gt: '2026-10-20T00:00:00' } }] })),
        isNull: await att(() => ids({ d2: null })),
    }
}
console.log('PROBE_JSON=' + JSON.stringify(out))
`


if (isWindows()) {
    describe('WOrmMdb 浮動時間: 重複安裝佈局(reladb帶巢狀sequelize副本)下DATE欄仍正確辨識與換算(R-FLOAT-00)', function() {

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(path.join(fdTmp, 'node_modules', 'w-orm-reladb', 'node_modules'), { recursive: true })
            //本套件原始碼(排除Jet中介檔)
            fs.cpSync('./src', path.join(fdTmp, 'src'), { recursive: true, filter: (p) => !/[\\/]_[A-Za-z0-9]+_(in\.json|res\.json|q\d+\.jsonl)$/.test(p) })
            //reladb: 只複製src與package.json; 另附自己的sequelize副本(身分不同於上層解析到的那份)
            fs.cpSync(path.join(dirOf('w-orm-reladb'), 'src'), path.join(fdTmp, 'node_modules', 'w-orm-reladb', 'src'), { recursive: true })
            fs.copyFileSync(path.join(dirOf('w-orm-reladb'), 'package.json'), path.join(fdTmp, 'node_modules', 'w-orm-reladb', 'package.json'))
            fs.cpSync(dirOf('sequelize'), path.join(fdTmp, 'node_modules', 'w-orm-reladb', 'node_modules', 'sequelize'), { recursive: true })
            fs.copyFileSync('./package.json', path.join(fdTmp, 'package.json'))
            fs.writeFileSync(path.join(fdTmp, 'probe.mjs'), PROBE)
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true })
            }
            catch (err) {}
        })

        it('兩份sequelize身分確實不同(佈局自證), DATE/DATEONLY/STRING仍由type.key補判分類, 負偏移時區之哨兵、Date/epoch條件、多DATE欄皆正確', function() {
            let r = spawnSync(process.execPath, ['probe.mjs'], { cwd: path.resolve(fdTmp), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
            let m = /PROBE_JSON=(.*)/.exec(r.stdout || '')
            assert.strict.ok(m, `probe無輸出: ${(r.stderr || '').slice(0, 500)}`)
            let o = JSON.parse(m[1])

            //佈局自證: 類別身分不同(否則本測試退化為單一佈局而失去鑑別力)
            assert.strict.strictEqual(o.sameClass, false, '兩份sequelize須為不同模組實體')
            assert.strict.strictEqual(o.sameDate, false, 'DATE類別須不同')
            //分類: instanceof對跨實體為假, 靠type.key補判
            assert.strict.strictEqual(o.kindDate, 'date')
            assert.strict.strictEqual(o.kindDateOnly, 'dateonly')
            assert.strict.strictEqual(o.kindStr, 'str')

            let tzs = Object.keys(o.tz)
            assert.strict.deepStrictEqual(tzs, ['America/Los_Angeles', 'Asia/Taipei', 'Etc/GMT+12'])
            assert.strict.ok(o.tz['America/Los_Angeles'].offsetWinter > 0 && o.tz['Etc/GMT+12'].offsetWinter > 0, '負偏移時區須生效(getTimezoneOffset為正)')
            assert.strict.ok(o.tz['Asia/Taipei'].offsetWinter < 0, 'Taipei須生效')
            for (let tz of tzs) {
                let t = o.tz[tz]
                //R-FLOAT-01: 哨兵不小於今日(修前負偏移時區誤命中never)
                assert.strict.deepStrictEqual(t.lt, ['expired'], `${tz} $lt字串`)
                assert.strict.deepStrictEqual(t.ltDate, ['expired'], `${tz} $lt Date`)
                assert.strict.deepStrictEqual(t.ltEpoch, ['expired'], `${tz} $lt epoch`)
                assert.strict.deepStrictEqual(t.sentinelStr, ['never'], `${tz} 哨兵字串`)
                assert.strict.deepStrictEqual(t.sentinelDate, ['never'], `${tz} 哨兵Date`)
                //多DATE欄(第二個DATE欄亦換算)
                assert.strict.deepStrictEqual(t.d2lt, ['never'], `${tz} d2 $lt`)
                assert.strict.deepStrictEqual(t.d2gte, ['expired'], `${tz} d2哨兵`)
                assert.strict.deepStrictEqual(t.both, ['expired'], `${tz} 兩欄$and`)
                assert.strict.deepStrictEqual(t.isNull, ['future'], `${tz} IS NULL`)
            }
        })

    })
}
