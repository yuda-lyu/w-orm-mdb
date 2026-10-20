/* eslint-disable no-new-wrappers */ //本檔刻意以new String、new Boolean、new Number建構包裝物件, 驗證日期欄對非Date物件值之處置
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import jetOpen from '../src/jet.mjs'
import { escVal } from '../src/getCmd.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import withTz from './tools/withTz.mjs'


//spec: CLAUDE_rulebook.md之R-DATE(寫入DATE欄之日期範圍與字串正規化), 事實出處為Jet 4.0實測:
//  Jet DATETIME以本地時間分量存放, 範圍為本地0100-01-01至9999-12-31T23:59:59; 年0–99被兩位數年規則靜默改年, 年>=10000報語法錯
//  R-DATE-01 範圍為本地年100–9999(不是UTC年); R-DATE-04 檢查之值即使用之值; R-DATE-05 字串之正規化(O1)與拒收
//本檔: 一、純函數(無Jet); 二、Jet對照組——對每個(時區, 瞬間)先讓真Jet判定「寫入後存值是否等於寫入之本地分量」, 再要求inJetDate與之相同


let nm = 'date-range'
let fdTmp = `./test/temp-${nm}`
let fpStorage = `${fdTmp}/${nm}.mdb`

//Manila之早年LMT為負偏移逾12小時(UTC-15:56); Etc/GMT-14恆為+14(年100邊界上Kiritimati為LMT-10:29, 正偏移最大僅Taipei+8:06); Kathmandu為+5:45(非整點偏移)
//對照組由真Jet判定, 不倚賴時區資料庫版本; withTz遇無效時區名稱會拋錯, 不會靜默落到UTC
const TZS = ['Asia/Taipei', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Etc/GMT+12', 'Etc/GMT-14', 'Asia/Kolkata', 'Asia/Kathmandu', 'America/Sao_Paulo', 'Asia/Manila']
const p2 = (n) => String(n).padStart(2, '0')
const p4 = (n) => String(n).padStart(4, '0')


//mkLocal, 以本地分量建Date(setFullYear避免new Date(y,…)把0–99年映射為1900+)
function mkLocal(y, mo = 6, d = 15, h = 12, mi = 0, s = 0, ms = 0) {
    let t = new Date(2000, 0, 1, 0, 0, 0, 0)
    t.setFullYear(y, mo - 1, d)
    t.setHours(h, mi, s, ms)
    return t
}

//mkUtc, 以UTC分量建Date
function mkUtc(y, mo = 1, d = 1, h = 0, mi = 0, s = 0, ms = 0) {
    let t = new Date(0)
    t.setUTCFullYear(y, mo - 1, d)
    t.setUTCHours(h, mi, s, ms)
    return t
}

//INSTANTS, 年100與9999邊界與3位數年之25個瞬間(本地分量建構與UTC分量建構各一部分; 於各時區本地年不同)
const INSTANTS = [
    ['U 0000-12-31T23:59:59Z', () => mkUtc(0, 12, 31, 23, 59, 59)],
    ['U 0001-01-01T00:00:00Z', () => mkUtc(1, 1, 1)],
    ['U 0001-06-15T00:00:00Z', () => mkUtc(1, 6, 15)],
    ['U 0029-06-15T00:00:00Z', () => mkUtc(29, 6, 15)],
    ['U 0050-06-15T00:00:00Z', () => mkUtc(50, 6, 15)],
    ['U 0099-12-31T00:00:00Z', () => mkUtc(99, 12, 31)],
    ['U 0099-12-31T23:59:59Z', () => mkUtc(99, 12, 31, 23, 59, 59)],
    ['U 0100-01-01T00:00:00Z', () => mkUtc(100, 1, 1)],
    ['U 0100-01-01T23:59:59Z', () => mkUtc(100, 1, 1, 23, 59, 59)],
    ['U 0100-06-15T12:00:00Z', () => mkUtc(100, 6, 15, 12)],
    ['U 0101-01-01T00:00:00Z', () => mkUtc(101, 1, 1)],
    ['U 0500-06-15T12:00:00Z', () => mkUtc(500, 6, 15, 12)],
    ['U 0999-06-15T12:00:00Z', () => mkUtc(999, 6, 15, 12)],
    ['U 1899-12-30T12:00:00Z', () => mkUtc(1899, 12, 30, 12)],
    ['U 2026-06-15T12:00:00Z', () => mkUtc(2026, 6, 15, 12)],
    ['U 9999-06-15T12:00:00Z', () => mkUtc(9999, 6, 15, 12)],
    ['U 9999-12-30T12:00:00Z', () => mkUtc(9999, 12, 30, 12)],
    ['U 9999-12-31T00:00:00Z', () => mkUtc(9999, 12, 31)],
    ['U 9999-12-31T12:00:00Z', () => mkUtc(9999, 12, 31, 12)],
    ['U 9999-12-31T23:59:59.999Z', () => mkUtc(9999, 12, 31, 23, 59, 59, 999)],
    ['U 10000-01-01T00:00:00Z', () => mkUtc(10000, 1, 1)],
    ['L 0099-12-31T23:59:59', () => mkLocal(99, 12, 31, 23, 59, 59)],
    ['L 0100-01-01T00:00:00', () => mkLocal(100, 1, 1, 0, 0, 0)],
    ['L 9999-12-31T23:59:59', () => mkLocal(9999, 12, 31, 23, 59, 59)],
    ['L 10000-01-01T00:00:00', () => mkLocal(10000, 1, 1, 0, 0, 0)],
]


describe('WOrmMdb date-range 純函數(R-DATE-00、01、04、05)', function() {

    //動態載入, 令模組不存在時僅本段失敗而不影響其餘段落之執行
    let dr = null
    before(async function() {
        dr = await import('../src/dateRange.mjs')
    })

    it('常數: 本地年100–9999(R-DATE-01)', function() {
        assert.strict.strictEqual(dr.YEAR_MIN, 100)
        assert.strict.strictEqual(dr.YEAR_MAX, 9999)
    })

    it('withTz確實切換並還原時區(本檔Jet對照組之前提)', async function() {
        let off0 = new Date(2026, 0, 1).getTimezoneOffset()
        assert.strict.strictEqual(await withTz('Asia/Taipei', () => new Date(2026, 0, 1).getTimezoneOffset()), -480)
        assert.strict.strictEqual(await withTz('America/Los_Angeles', () => new Date(2026, 0, 1).getTimezoneOffset()), 480)
        assert.strict.strictEqual(new Date(2026, 0, 1).getTimezoneOffset(), off0, '還原')
        await assert.rejects(withTz('Asia/Taipei', () => {
            throw new Error('boom')
        }), /boom/)
        assert.strict.strictEqual(new Date(2026, 0, 1).getTimezoneOffset(), off0, '拋錯亦還原')
    })

    it('inJetDate: 以本地分量建構之邊界, 各時區皆同(本地年100–9999為界)', async function() {
        for (let tz of TZS) {
            await withTz(tz, () => {
                assert.strict.strictEqual(dr.inJetDate(mkLocal(99, 12, 31, 23, 59, 59)), false, `${tz} 本地0099末`)
                assert.strict.strictEqual(dr.inJetDate(mkLocal(100, 1, 1, 0, 0, 0)), true, `${tz} 本地0100初`)
                assert.strict.strictEqual(dr.inJetDate(mkLocal(9999, 12, 31, 23, 59, 59)), true, `${tz} 本地9999末`)
                assert.strict.strictEqual(dr.inJetDate(mkLocal(10000, 1, 1, 0, 0, 0)), false, `${tz} 本地10000初`)
                assert.strict.strictEqual(dr.inJetDate(mkLocal(2026, 6, 15)), true, `${tz} 2026`)
            })
        }
    })

    it('inJetDate: Invalid Date、超出Date範圍者為false', function() {
        assert.strict.strictEqual(dr.inJetDate(new Date(NaN)), false)
        assert.strict.strictEqual(dr.inJetDate(new Date(8.64e15)), false)
        assert.strict.strictEqual(dr.inJetDate(new Date(-8.64e15)), false)
    })

    it('inJetDate: 取值不讀子類別覆寫之方法(R-DATE-04, 兩方向)', function() {
        class Liar extends Date {
            getFullYear() {
                return 50 //真實為2026, 謊稱50
            }
        }
        class LiarInv extends Date {
            getFullYear() {
                return 2026 //真實為年50, 謊稱2026
            }
        }
        let a = new Liar(2000, 0, 1)
        a.setFullYear(2026)
        let b = new LiarInv(2000, 0, 1)
        b.setFullYear(50)
        assert.strict.strictEqual(dr.inJetDate(a), true)
        assert.strict.strictEqual(dr.inJetDate(b), false)
    })

    it('escVal: Date分支為最後一道防線(同一判定), 越界與Invalid Date拋出且不回顯值(R-DATE-00、03)', function() {
        assert.strict.strictEqual(escVal(mkLocal(2026, 6, 15, 12, 0, 0)), '#2026-06-15 12:00:00#')
        assert.strict.strictEqual(escVal(mkLocal(100, 1, 1, 0, 0, 0)), '#100-01-01 00:00:00#')
        for (let d of [mkLocal(50), mkLocal(99, 12, 31, 23, 59, 59), mkLocal(10000, 1, 1, 0, 0, 0), new Date(NaN)]) {
            assert.strict.throws(() => escVal(d), /^Error: invalid data: date is not a valid time in years 100-9999$/)
        }
    })

    it('escVal: 序列化亦不讀子類別覆寫之方法(R-DATE-04: 通過檢核者必為實際寫出者)', function() {
        class Liar extends Date {
            getFullYear() {
                return 50
            }

            getHours() {
                return 3
            }
        }
        let a = new Liar(2000, 0, 1)
        a.setFullYear(2026, 5, 15)
        a.setHours(12, 0, 0, 0)
        assert.strict.strictEqual(escVal(a), '#2026-06-15 12:00:00#', '真實時間為2026-06-15 12:00, 覆寫之getFullYear/getHours不得左右輸出')
    })

    describe('normDates(O1 與 M1, R-DATE-05)', function() {

        let cols = ['id', 'd', 's']
        let dateCols = new Set(['d'])
        let one = (v, ext = {}) => {
            let rows = [{ id: 'x', d: v, ...ext }]
            let bad = dr.normDates(rows, cols, dateCols)
            return { bad, v: rows[0].d, row: rows[0] }
        }

        it('無時區日期時間字串(select回傳形式)正規化為牆上時間字串, 小數秒捨去, 不經Date(O1)', function() {
            for (let [s, exp] of [
                ['2026-06-15T12:00:00', '2026-06-15 12:00:00'],
                ['2026-06-15T12:00:00.5', '2026-06-15 12:00:00'],
                ['2026-06-15T12:00:00.123', '2026-06-15 12:00:00'],
                ['0100-01-01T00:00:00', '0100-01-01 00:00:00'],
                ['9999-12-31T23:59:59', '9999-12-31 23:59:59'],
                ['2024-02-29T23:59:59', '2024-02-29 23:59:59'],
                ['2000-02-29T00:00:00', '2000-02-29 00:00:00'],
                ['2026-03-08T02:30:00', '2026-03-08 02:30:00'], //美西夏令跳過之時刻亦原樣
                ['2026-06-15T12:00:00.123456', '2026-06-15 12:00:00'], //小數秒不限位數(外審minimax)
                ['2026-06-15 12:00:00', '2026-06-15 12:00:00'], //空格分隔之同形(外審opus F4), 驗曆法後原樣
                ['2026-06-15 12:00:00.500', '2026-06-15 12:00:00'],
            ]) {
                let r = one(s)
                assert.strict.strictEqual(r.bad, null, s)
                assert.strict.strictEqual(r.v, exp, s)
            }
        })

        it('無時區日期時間字串與純日期: 曆法或年不符者整批拒收(原為Jet 3464)', function() {
            for (let s of [
                '0099-12-31T23:59:59', '0000-01-01T00:00:00', '2026-02-29T00:00:00', '2026-02-30T00:00:00', '2100-02-29T00:00:00', '1900-02-29T00:00:00',
                '2026-13-01T00:00:00', '2026-00-10T00:00:00', '2026-06-00T00:00:00', '2026-06-15T24:00:00', '2026-06-15T12:60:00', '2026-06-15T12:00:60',
                '2026-02-30 00:00:00', '2026-06-31 12:00:00', '0099-12-31 23:59:59', //空格分隔
                '2026-02-30', '2026-06-31', '2026-13-01', '2100-02-29', '0000-01-01', //純日期
            ]) {
                assert.strict.deepStrictEqual(one(s).bad, { k: 0, col: 'd' }, s)
            }
            for (let s of ['2026-06-15', '2024-02-29', '0100-01-01', '9999-12-31']) {
                let r = one(s)
                assert.strict.strictEqual(r.bad, null, s)
                assert.strict.strictEqual(r.v, s, `${s} 純日期驗曆法後原樣交Jet`)
            }
        })

        it('含Z或偏移之ISO字串轉為Date(瞬間無歧義), 再依本地年判定', function() {
            for (let [s, iso] of [
                ['2026-06-15T12:00:00Z', '2026-06-15T12:00:00.000Z'],
                ['2026-06-15T12:00:00.123Z', '2026-06-15T12:00:00.123Z'],
                ['2026-06-15T12:00:00+08:00', '2026-06-15T04:00:00.000Z'],
                ['2026-06-15T12:00:00+0800', '2026-06-15T04:00:00.000Z'],
                ['2026-06-15T12:00:00-05:30', '2026-06-15T17:30:00.000Z'],
                ['2026-06-15 12:00:00Z', '2026-06-15T12:00:00.000Z'],
                ['0100-06-15T12:00:00Z', '0100-06-15T12:00:00.000Z'], //取年中: 任何主機時區(含早年LMT逾12小時者)本地年皆為100
            ]) {
                let r = one(s)
                assert.strict.strictEqual(r.bad, null, s)
                assert.strict.strictEqual(Object.getPrototypeOf(r.v), Date.prototype, s)
                assert.strict.strictEqual(r.v.toISOString(), iso, s)
            }
        })

        it('含Z或偏移之ISO字串: 曆法不符、偏移不合法、本地年<100者拒收', function() {
            for (let s of [
                '2026-02-30T00:00:00Z', '2026-06-15T24:00:00Z', '2026-06-15T12:00:00+24:00', '2026-06-15T12:00:00+08:60',
                '0099-06-15T12:00:00Z', '0000-06-15T12:00:00Z', '0050-06-15T00:00:00+08:00', //年中: 任何主機時區本地年皆<100
            ]) {
                assert.strict.deepStrictEqual(one(s).bad, { k: 0, col: 'd' }, s)
            }
        })

        it('零填充小年份(獨立數字串達3位以上而值<100)之任何寫法皆拒收, 含真Jet實測會被靜默改年之各種文法(外審opus F1)', function() {
            for (let s of [
                '0050-06-15', '0050-06-15 12:00:00', '0050/06/15', '0000-01-01', '06/15/0050', '6/15/0099', //兩種基本形狀
                '0050年6月15日', 'June 15, 0050', '15 Jun 0050', '15-Jun-0050', '0050-Jun-15', 'June 0050', '0050 06 15', '12:00 0050-06-15', '12:00:00 06/15/0050',
                '0050-06', '06/0050', '0050/06', '6/0050', '050-06-15', '06/15/050', '099-12-31', '001-06-15', '15.06.0050', //其餘文法與3位數年
                '０050-06-15', '００５０-０６-１５', //全形數字(NFKC後判定)
                '12:00:00.007', //3位數且<100(Jet本即報錯, 以日期訊息取代)
            ]) {
                assert.strict.deepStrictEqual(one(s).bad, { k: 0, col: 'd' }, JSON.stringify(s))
            }
        })

        it('5位數以上之年份(年在前或在後)拒收(Jet報錯); 兩位數年、4位數合法年與其餘寫法交Jet(原樣)', function() {
            for (let s of ['10000-01-01', '10000-01-01 00:00:00', '10000/1/1', '1/1/10000', '12345-06-15']) {
                assert.strict.deepStrictEqual(one(s).bad, { k: 0, col: 'd' }, s)
            }
            for (let s of [
                '0100-06-15', '2026/06/15', '6/15/50', '50-06-15', '100-01-01', '6/15/2026', '15 Jun 2026', '2026年6月15日', '2026-06-15 12:00', '0100-01-01', '01/01/0100', //合法寫法(含3位數年100以上與兩位數年)
                'garbage', '', '   ', '12', '45000', '20260615', '13/01/2026', //Jet自行判定(多為3464; 13/01/2026被Jet讀成2026-01-13, 屬區域設定, LD)
            ]) {
                let r = one(s)
                assert.strict.strictEqual(r.bad, null, JSON.stringify(s))
                assert.strict.strictEqual(r.v, s, `${JSON.stringify(s)} 原樣`)
            }
        })

        it('數值、布林、null、undefined不處理(現況行為不變, LD2)', function() {
            for (let v of [0, 40000, 1700000000000, true, false, null, undefined]) {
                let r = one(v)
                assert.strict.strictEqual(r.bad, null)
                assert.strict.strictEqual(r.v, v)
            }
        })

        it('DATE欄之非Date物件(字串包裝物件、陣列、自訂toString): escVal以String(v)當字串寫出, 故取同一字串判定並以原始字串取代(外審opus F2)', function() {
            //拒收者
            for (let v of [new String('0050-06-15'), ['0050-06-15'], { toString: () => '0050-06-15' }, new String('0050年6月15日'), new String('2026-02-30T00:00:00')]) {
                assert.strict.deepStrictEqual(one(v).bad, { k: 0, col: 'd' }, String(v))
            }
            //O1形式之包裝物件亦正規化
            let r = one(new String('2026-06-15T12:00:00'))
            assert.strict.strictEqual(r.bad, null)
            assert.strict.strictEqual(r.v, '2026-06-15 12:00:00')
            //其餘物件換成String(v)之原始字串(檢查之值即使用之值): escVal對它們原本就是String(v)
            for (let [v, exp] of [[{}, '[object Object]'], [[1], '1'], [new String('2026-06-15'), '2026-06-15'], [new Boolean(false), 'false'], [new Number(5), '5']]) {
                let r2 = one(v)
                assert.strict.strictEqual(r2.bad, null)
                assert.strict.strictEqual(r2.v, exp)
                assert.strict.strictEqual(typeof r2.v, 'string')
            }
            //String(v)拋錯者(無原型物件)無從寫出, 視為不可寫入
            assert.strict.deepStrictEqual(one(Object.create(null)).bad, { k: 0, col: 'd' })
            //每次取值皆不同之toString只被讀一次
            let n = 0
            let rows = [{ id: 'a', d: { toString: () => (n++ === 0 ? '2026-06-15' : '0050-06-15') } }]
            assert.strict.strictEqual(dr.normDates(rows, cols, dateCols), null)
            assert.strict.strictEqual(rows[0].d, '2026-06-15')
            assert.strict.strictEqual(n, 1)
        })

        it('非DATE欄之物件與字串皆不處理', function() {
            let rows = [{ id: 'a', s: new String('0050-06-15') }, { id: 'b', s: ['0050-06-15'] }]
            assert.strict.strictEqual(dr.normDates(rows, cols, dateCols), null)
            assert.strict.strictEqual(typeof rows[0].s, 'object')
        })

        it('含Z或偏移之ISO字串依「本地年」而非UTC年判定: 同一字串在不同主機時區結果相反(外審opus M7、minimax)', async function() {
            //Asia/Taipei: 0099-12-31T20:00:00Z 之本地時間為0100-01-01 04:00(偏移+8:00或早年LMT+8:06), 本地年100可存; 以UTC年判定會誤拒
            await withTz('Asia/Taipei', () => {
                let r = one('0099-12-31T20:00:00Z')
                assert.strict.strictEqual(r.bad, null)
                assert.strict.strictEqual(r.v.getFullYear(), 100)
                //9999-12-31T20:00:00Z 之本地時間已是10000-01-01, 以UTC年判定會誤放
                assert.strict.deepStrictEqual(one('9999-12-31T20:00:00Z').bad, { k: 0, col: 'd' })
            })
            //America/Los_Angeles: 0100-01-01T05:00:00Z 之本地時間為0099-12-31 21:00前後(偏移-8:00或早年LMT-7:52), 本地年99, 以UTC年判定會誤放
            await withTz('America/Los_Angeles', () => {
                assert.strict.deepStrictEqual(one('0100-01-01T05:00:00Z').bad, { k: 0, col: 'd' })
                let r = one('9999-12-31T20:00:00Z')
                assert.strict.strictEqual(r.bad, null)
                assert.strict.strictEqual(r.v.getFullYear(), 9999)
            })
        })

        it('非DATE欄: 字串不處理, Date一律檢核(Date寫入STRING欄亦被Jet改年)', function() {
            let r = one('x', { s: '0050-06-15' })
            assert.strict.strictEqual(r.bad, null)
            assert.strict.strictEqual(r.row.s, '0050-06-15')
            assert.strict.strictEqual(r.row.d, 'x')
            let rows = [{ id: 'a', s: mkLocal(50) }]
            assert.strict.deepStrictEqual(dr.normDates(rows, cols, dateCols), { k: 0, col: 's' })
            let rows2 = [{ id: 'a', s: mkLocal(2026) }]
            assert.strict.strictEqual(dr.normDates(rows2, cols, dateCols), null)
        })

        it('通過檢核之Date換成一般Date(檢查之值即使用之值), 子類別與覆寫之方法被剝除', function() {
            class MyDate extends Date {
                getTime() {
                    return 0
                }
            }
            let t = mkLocal(2026, 6, 15, 12)
            let sub = new MyDate(t.valueOf())
            let rows = [{ id: 'a', d: sub }]
            assert.strict.strictEqual(dr.normDates(rows, cols, dateCols), null)
            assert.strict.strictEqual(Object.getPrototypeOf(rows[0].d), Date.prototype)
            assert.strict.strictEqual(Date.prototype.getTime.call(rows[0].d), t.valueOf())
        })

        it('回報第一個不可寫入者: 索引最小、同筆依欄位順序; 非物件之列略過', function() {
            let rows = [{ id: 'a', d: mkLocal(2026) }, { id: 'b', s: mkLocal(50), d: mkLocal(50) }, { id: 'c', d: mkLocal(50) }]
            assert.strict.deepStrictEqual(dr.normDates(rows, cols, dateCols), { k: 1, col: 'd' }, '同筆多欄回報欄位順序(cols)之第一個')
            let rows2 = [null, 5, 'x', { id: 'a', d: mkLocal(2026) }]
            assert.strict.strictEqual(dr.normDates(rows2, cols, dateCols), null)
        })

        it('只檢核cols內之欄位(不在model之鍵不會被寫入, 不檢)', function() {
            let rows = [{ id: 'a', zz: mkLocal(50) }]
            assert.strict.strictEqual(dr.normDates(rows, cols, dateCols), null)
        })

    })

})


if (isWindows()) {
    describe('WOrmMdb date-range Jet對照組(R-DATE-01: 本地年100–9999與真Jet吻合)', function() {

        let jet = null

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdTmp, { recursive: true })
            fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpStorage)
            jet = jetOpen({ path: path.resolve(fpStorage), password: '' })
        })

        after(function() {
            cleanStorage(fdTmp)
        })

        let dr = null
        before(async function() {
            dr = await import('../src/dateRange.mjs')
        })

        for (let tz of TZS) {
            it(`${tz}: ${INSTANTS.length}個瞬間, inJetDate為真 ⇔ 真Jet寫入後存值等於寫入之本地分量`, async function() {
                await withTz(tz, async() => {
                    //以不經 escVal 之獨立方式組出 Jet 日期常值(本地分量, 年不補零, 同 1.0.38 之 escVal 輸出)
                    let lit = (d) => `#${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}#`
                    let want = (d) => `${p4(d.getFullYear())}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
                    let ds = INSTANTS.map(([lb, mk]) => [lb, mk()])
                    let cmds = [{ type: 'execute', sql: 'DELETE FROM [tt]' }]
                    ds.forEach(([lb, d], i) => {
                        cmds.push({ type: 'execute', sql: `INSERT INTO [tt] ([id], [fDate]) VALUES ('c${p2(i)}', ${lit(d)})`, stopOnError: false })
                    })
                    let r = await jet.run(cmds)
                    assert.strict.ok(r.results[0].ok)
                    let rows = await jet.query('SELECT [id], [fDate] FROM [tt]')
                    let by = Object.fromEntries(rows.map((x) => [x.id, x.fDate]))
                    let nExact = 0
                    ds.forEach(([lb, d], i) => {
                        let exact = by[`c${p2(i)}`] === want(d)
                        if (exact) {
                            nExact++
                        }
                        assert.strict.strictEqual(dr.inJetDate(d), exact, `${tz} ${lb} (本地年${d.getFullYear()}, Jet存值${by[`c${p2(i)}`]})`)
                    })
                    assert.strict.ok(nExact >= 10 && nExact < ds.length, `${tz} 對照組須同時含接受與拒絕之格(實 ${nExact}/${ds.length})`)
                })
            })
        }

    })
}
