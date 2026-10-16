import Sequelize from 'sequelize'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-FIND(非主鍵條件依 w-orm-reladb 1.1.9 帳本 R1–R6, 主鍵條件依本套件 R-PK-03/05)
//本檔: S 組(sequelize 名稱與 Symbol)、K 組(特殊鍵與異常物件)、D 組(DATE)、B 組(BOOLEAN)、PK 組(1.0.35 主鍵行為不得退化),
//以及本輪新增之 new:SK(嚴格鍵)、new:SY(只有 Symbol 鍵)、new:LN(length 鍵)、new:NE(不可列舉之鍵)、new:DT(dateNoTz)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


let Op = Sequelize.Op

function but(...xs) {
    return butAll(ALL, ...xs)
}

const L300 = 'z'.repeat(300)

function getterFind() {
    let o = {}
    Object.defineProperty(o, 'name', {
        enumerable: true,
        get() {
            throw new Error('getter boom')
        },
    })
    return o
}

function cycleFind() {
    let o = { name: 'abc' }
    o.self = o
    return o
}

function sparse(a, b) {
    let arr = [a]
    arr[2] = b
    return arr
}

//同一物件被引用兩次之循環參照: 快照須以記錄已走訪者處理, 逐層展開為指數成長
function cycle2Find() {
    let o = {}
    o.a = o
    o.b = o
    return o
}

//經邏輯鍵之循環參照
function cycleAndFind() {
    let o = { $and: [] }
    o.$and.push(o)
    return o
}

//同一子條件物件於兩處共用(非循環): 合法
function sharedFind() {
    let x = { name: 'abc' }
    return { $or: [x, { $and: [x, { value: 0 }] }] }
}

//n層$and巢狀, 最內層為讀值結果會變之主鍵getter(第一次{$ne:'a'}, 其後{$ne:'b'}): 快照須涵蓋cvFind深度上限內之全部層級
function deepFlipFind(n) {
    let k = 0
    let inner = {
        get id() {
            k++
            return k === 1 ? { $ne: 'a' } : { $ne: 'b' }
        },
    }
    let o = inner
    for (let i = 0; i < n; i++) {
        o = { $and: [o] }
    }
    return o
}

function nonEnum(k, v) {
    let o = {}
    Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    return o
}


const CASES = [
    //S: sequelize 專屬名稱 reject; Symbol 鍵須為 Op 成員(reladb R2、R3); 主鍵欄 Symbol 運算子比照 $ 運算子(R-FIND-03)
    { key: 'S1', find: () => ({ name: { $like: 'pe%' } }), exp: 'REJECT' },
    { key: 'S2', find: () => ({ name: { $startsWith: 'pe' } }), exp: 'REJECT' },
    { key: 'S3', find: () => ({ value: { $between: [1, 2] } }), exp: 'REJECT' },
    { key: 'S4', find: () => ({ name: { $col: 'id' } }), exp: 'REJECT' },
    { key: 'S5', find: () => ({ name: { $iLike: 'pe%' } }), exp: 'REJECT' },
    { key: 'S6', find: () => ({ id: { [Op.in]: ['a', 'b'] } }), exp: 'a,b' },
    { key: 'S6b', find: () => ({ name: { [Op.in]: ['abc'] } }), exp: 'g' },
    { key: 'S7', find: () => ({ [Op.or]: [{ id: 'a' }, { id: 'b' }] }), exp: 'a,b' }, //頂層Symbol鍵不得被丟棄(1.0.35刪光全表)
    { key: 'S8', find: () => ({ name: { $regexp: '^pe' } }), exp: 'REJECT' },
    { key: 'S9', find: () => ({ [Symbol('x')]: 1 }), exp: 'REJECT' }, //非Op之Symbol reject(1.0.35刪光全表)
    { key: 'S10', find: () => ({ name: { [Op.or]: ['abc', 'peter'] } }), exp: 'REJECT' },
    { key: 'S11', find: () => ({ name: { [Op.like]: 'pe%' } }), exp: 'a,b' }, //原生Symbol為呼叫端自負之原生寫法
    { key: 'S12', find: () => ({ [Op.not]: { id: 'a' } }), exp: but('a') },
    { key: 'S13', find: () => ({ [Op.and]: [{ value: 2 }], name: 'a.c' }), exp: 'f' },
    { key: 'S14', find: () => ({ id: { [Op.ne]: 'a' } }), exp: but('a') },
    { key: 'S15', find: () => ({ id: { [Op.like]: 'x%' } }), exp: 'x_1' },

    //K: 特殊鍵與異常物件(R-FIND-02; reladb R2、R4)
    { key: 'K1', find: () => ({ length: 0 }), exp: 'a' }, //欄名length不得使條件被當成陣列樣而丟棄(1.0.35刪光全表)
    { key: 'K2', find: () => ({ id: 'a', length: 0 }), exp: 'a' },
    { key: 'K3', find: () => ({ length: 3 }), exp: 'b' },
    { key: 'K4', find: () => ({ id: 'b', length: 2 }), exp: '' },
    { key: 'K5', find: () => ({ 'p$x': 'q' }), exp: 'a' }, //欄名含$(非首尾)
    { key: 'K6', find: () => JSON.parse('{"__proto__":1,"id":"a"}'), exp: 'REJECT' }, //__proto__自有鍵reject
    { key: 'K7', find: () => ({ name: 'peter', length: { $gte: 0 } }), exp: 'a,b' },
    { key: 'K8', find: getterFind, exp: 'REJECT' }, //讀值拋錯: reject且發一次error事件
    { key: 'K9', find: cycleFind, exp: 'REJECT', rej: /circular reference/ }, //循環參照由快照拒收(R-FIND-02)
    { key: 'K10', find: () => ({ '': 1 }), exp: 'REJECT' }, //空欄名reject(1.0.35刪光全表)
    { key: 'K11', find: () => ({ id: { $in: sparse('a', 'b') } }), exp: 'a,b' }, //主鍵肯定語境之洞為無效值不命中(R-PK-03)
    { key: 'K11b', find: () => ({ name: { $in: sparse('abc', 'peter') } }), exp: 'REJECT' }, //非主鍵陣列之洞reject
    { key: 'K12', find: () => ({ id: { $in: ['a', undefined] } }), exp: 'a' }, //R-PK-03
    { key: 'K13', find: () => ({ id: { $nin: ['a', undefined] } }), exp: 'REJECT' }, //否定語境無效值reject(R-PK-03)
    { key: 'K14', find: () => ({ name: { $in: 'abc' } }), exp: 'REJECT' }, //非主鍵$in純量reject
    { key: 'K15', find: () => ({ id: { $in: 'a' } }), exp: 'a' }, //主鍵$in純量視為單元素陣列(1.0.35)

    //D: DATE 欄(reladb R4; dateNoTz:'local', Q3)
    { key: 'D1', find: () => ({ dt: '2026-01-01T00:00:00' }), exp: 'a' }, //Jet回傳格式之無時區字串依主機時區
    { key: 'D2', find: () => ({ dt: new Date(2026, 0, 1) }), exp: 'a' },
    { key: 'D3', find: () => ({ dt: { $gt: '2026-03-01T00:00:00+08:00' } }), exp: 'b,d' },
    { key: 'D4', find: () => ({ dt: { $lt: 'garbage' } }), exp: 'REJECT' }, //1.0.35誤刪
    { key: 'D5', find: () => ({ dt: { $gt: new Date(2026, 0, 1).getTime() } }), exp: 'b,d' }, //epoch(以本地時間分量建構, 不依主機時區; 原載固定值1767196800000為UTC+8之午夜, run02外審opus、sol)
    { key: 'D6', find: () => ({ dt: null }), exp: 'c,e,f,g,h,i,j,x_1' },
    { key: 'D7', find: () => ({ dt: '2026-01-01' }), exp: 'REJECT' }, //純日期reject(dateNoTz不收純日期)
    { key: 'D8', find: () => ({ dt: { $ne: null } }), exp: 'a,b,d' },
    { key: 'D9', find: () => ({ dt: { $gt: '2026-03-01T00:00:00' } }), exp: 'b,d' }, //無時區範圍
    { key: 'new:DT1', find: () => ({ dt: '2026-01-01 00:00:00' }), exp: 'a' }, //單一空白分隔
    { key: 'new:DT2', find: () => ({ dt: { $in: ['2026-01-01T00:00:00', '2026-06-01T00:00:00'] } }), exp: 'a,b' }, //$in之元素皆套用dateNoTz

    //B: BOOLEAN 欄(reladb R4)
    { key: 'B1', find: () => ({ b: true }), exp: 'a,e' },
    { key: 'B2', find: () => ({ b: 1 }), exp: 'a,e' },
    { key: 'B3', find: () => ({ b: { $ne: true } }), exp: but('a', 'e') },
    { key: 'B4', find: () => ({ b: 'true' }), exp: 'REJECT' },

    //PK: 1.0.35 之主鍵行為不得退化(R-PK-03/05)
    { key: 'PK1', find: () => ({ id: 'A ' }), exp: 'a' }, //Jet等值: 大小寫+尾端空白
    { key: 'PK2', find: () => ({ id: { $ne: 'A ' } }), exp: but('a') }, //$ne不得刪除Jet視為同鍵之列
    { key: 'PK3', find: () => ({ id: { $nin: ['A ', 'Ｂ'] } }), exp: but('a', 'b') }, //全形
    { key: 'PK4', find: () => ({ id: { $gt: 'w' } }), exp: 'x_1' }, //範圍NOCASE(L2)
    { key: 'PK5', find: () => ({ id: { $ne: undefined } }), exp: 'REJECT' }, //否定語境無效值reject
    { key: 'PK6', find: () => ({ id: undefined }), exp: '' }, //肯定語境無效值不命中(Q5)
    { key: 'PK7', find: () => ({ id: { $gt: undefined } }), exp: '' }, //肯定語境範圍之無效值不命中
    { key: 'PK8', find: () => ({ id: { $ne: null } }), exp: 'REJECT' }, //主鍵null為無效值, 否定語境reject
    { key: 'PK9', find: () => ({ id: 123 }), exp: '' }, //字串主鍵之數字轉'123'(R-PK-02), 無此列

    //new:SK 嚴格鍵(R-FIND-03/04; reladb 1.1.9 R4): 近似鍵不得繞過Jet之主鍵等值判定, 亦不得由sqlite之欄名解析命中
    { key: 'new:SK1', find: () => ({ ID: 'a' }), exp: 'REJECT', rej: /unknown column name \[ID\]/ }, //主鍵大小寫變體之鍵
    { key: 'new:SK2', find: () => ({ ID: { $ne: 'A ' } }), exp: 'REJECT', rej: /unknown column name \[ID\]/ }, //近似鍵之否定條件
    { key: 'new:SK3', find: () => ({ 'id ': 'a' }), exp: 'REJECT', rej: /unknown column name/ }, //尾端空白之鍵
    { key: 'new:SK4', find: () => ({ NAME: 'abc' }), exp: 'REJECT', rej: /unknown column name \[NAME\]/ }, //非主鍵大小寫變體之鍵
    { key: 'new:SK5', find: () => ({ rowid: { $lt: 'abc' } }), exp: 'REJECT', rej: /unknown column name \[rowid\]/ }, //sqlite隱含欄
    { key: 'new:SK6', find: () => ({ valueOf: 1 }), exp: 'REJECT', rej: /unsupported column name/ }, //Object.prototype成員名
    { key: 'new:SK7', find: () => ({ 'tc.id': 'a' }), exp: 'REJECT', rej: /unsupported column name/ }, //表.欄
    { key: 'new:SK8', find: () => ({ $or: [{ ID: 'a' }, { id: 'b' }] }), exp: 'REJECT', rej: /unknown column name \[ID\]/ }, //深層之近似鍵

    //new:SY 只有Symbol鍵之find: delAll不得走全刪(R-FIND-02)
    { key: 'new:SY1', find: () => ({ [Op.and]: [{ value: { $gt: 100 } }] }), exp: '' },
    { key: 'new:SY2', find: () => ({ [Op.or]: [{ name: 'zzz' }] }), exp: '' },
    { key: 'new:SY3', find: () => ({ [Op.and]: [{ id: 'a' }] }), exp: 'a' },
    { key: 'new:SY4', find: () => ({ [Op.not]: { value: { $ne: null } } }), exp: 'd' },

    //new:LN 具length鍵之find: 不得被當成陣列樣而丟棄(R-FIND-02)
    { key: 'new:LN1', find: () => ({ length: 99 }), exp: '' },
    { key: 'new:LN2', find: () => ({ length: { $gt: 100 } }), exp: '' },
    { key: 'new:LN3', find: () => ({ name: 'zzz', length: 0 }), exp: '' },
    { key: 'new:LN4', find: () => ({ length: 0, [Op.and]: [{ value: 1 }] }), exp: 'a' },

    //new:NE 只有不可列舉之鍵: delAll不得走全刪(R-FIND-02)
    { key: 'new:NE1', find: () => nonEnum('name', 'zzz'), exp: '' },
    { key: 'new:NE2', find: () => nonEnum('id', { $gt: L300 }), exp: '' }, //主鍵不可能存在值之肯定範圍不命中

    //new:CY 快照之循環參照、共用子物件與深層(R-FIND-02)
    { key: 'new:CY1', find: cycle2Find, exp: 'REJECT', rej: /circular reference/ }, //循環參照reject(不得逐層展開而卡住)
    { key: 'new:CY2', find: cycleAndFind, exp: 'REJECT', rej: /circular reference/ },
    { key: 'new:CY3', find: sharedFind, exp: 'g' }, //共用子物件照常
    { key: 'new:CY4', find: () => deepFlipFind(22), exp: but('a') }, //22層巢狀內之getter亦只讀一次, 不得因兩趟讀值不一而使主鍵條件消失

    //new:RV run02外審之回歸(R-FIND-02/03): 每個值只讀一次、入口一致、主鍵條件不因讀值不一而消失
    { key: 'new:RV1', find: flipWrapNe, exp: but('b') }, //覆寫valueOf之String包裝物件: 以內建valueOf讀內部值'b'(原兩趟讀值不一而刪光全表)
    { key: 'new:RV2', find: () => ({ id: { $nin: [{ [Symbol.toStringTag]: 'String', valueOf: () => 'b' }] } }), exp: 'REJECT', rej: /invalid id in negative condition/ }, //偽造toStringTag者非包裝物件, 否定語境之無效值
    { key: 'new:RV3', find: protoFlipFind, exp: '' }, //getPrototypeOf會變之Proxy主鍵值: 單趟走訪只判定一次(原兩趟判定不一而刪光全表)
    { key: 'new:RV4', find: () => () => true, exp: 'REJECT', rej: /plain object/ }, //函數作為find拒收(原視為{}而全刪)
    { key: 'new:RV5', find: () => Object.assign(function() {}, { id: 'a' }), exp: 'REJECT', rej: /plain object/ }, //函數之自有鍵條件不得被丟棄
    { key: 'new:RV6', find: throwingArrayFind, exp: ALL }, //陣列find視為{}且不讀其元素, select與delAll一致(原select讀元素而reject、delAll全刪)
    { key: 'new:RV7', find: revokedFind, exp: 'REJECT' }, //已撤銷之Proxy: 兩函數皆reject且各發一次error事件(原delAll判定於try外而不發)
    { key: 'new:RV8', find: () => ({ id: { $eq: 'a', $options: undefined } }), exp: 'a' }, //視同未給之$options不使主鍵條件被拒(同非主鍵之同形)
    { key: 'new:RV9', find: () => ({ name: { $eq: 'abc', $options: undefined } }), exp: 'g' }, //非主鍵同形對照
    { key: 'new:RV10', find: dateGetTimeFind, exp: '' }, //覆寫getTime之Date: 以內部值2000-01-01為準(原cvFind先檢後讀而刪a,b,d)
    { key: 'new:RV11', find: () => ({ id: movingRegex('a', '') }), exp: 'a' }, //覆寫source之RegExp: 以內部樣式/a/為準(原首讀a、後讀空字串而刪光全表)
    { key: 'new:RV12', find: () => ({ name: movingRegex('pet', '') }), exp: 'c,f,g,i,j' }, //非主鍵: 內部樣式/a/
    { key: 'new:PK10', find: () => ({ id: { $ne: 123 } }), exp: ALL }, //字串主鍵之數字轉'123'(有效), 否定語境不拒收(PK9之鑑別對照)
]


//覆寫valueOf之String包裝物件, 第一次回'b', 其後回'zzz'
function flipWrapNe() {
    let n = 0
    let s = new String('b') // eslint-disable-line no-new-wrappers
    s.valueOf = () => {
        n++
        return n === 1 ? 'b' : 'zzz'
    }
    return { id: { $ne: s } }
}

//getPrototypeOf於pk.mjs之isOpObj內第一次回Array.prototype(非運算子物件)、其後回Object.prototype(運算子物件{$nin:['a']}), 其餘呼叫回Array.prototype
function protoFlipFind() {
    let nOp = 0
    let P = new Proxy({ $nin: ['a'] }, {
        getPrototypeOf() {
            if (new Error().stack.indexOf('isOpObj') >= 0) {
                nOp++
                return nOp >= 2 ? Object.prototype : Array.prototype
            }
            return Array.prototype
        },
    })
    return { id: P }
}

//元素讀值拋錯之陣列
function throwingArrayFind() {
    let a = [{ id: 'a' }]
    Object.defineProperty(a, 0, {
        enumerable: true,
        get() {
            throw new Error('element boom')
        },
    })
    return a
}

//已撤銷之Proxy
function revokedFind() {
    let { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    return proxy
}

//覆寫getTime之Date: 於cvFind內回2000-01-01, 其餘回9999-12-31
function dateGetTimeFind() {
    let d = new Date(2000, 0, 1)
    let t0 = d.getTime()
    d.getTime = function() {
        return new Error().stack.indexOf('cvFind.mjs') >= 0 ? t0 : 253402214400000
    }
    return { dt: { $lt: d } }
}

//內部樣式為/a/而自有source getter首讀first、其後later之RegExp
function movingRegex(first, later) {
    let reads = 0
    let re = /a/
    Object.defineProperty(re, 'source', {
        get() {
            reads++
            return reads === 1 ? first : later
        },
    })
    return re
}


//model有而資料表無之欄(model過時): 引用之條件由嚴格鍵拒收(R-FIND-04), 不得因該欄於過濾表恆為NULL而命中全部
const CASES_STALE = [
    { key: 'new:ST1', find: () => ({ extra: null }), exp: 'REJECT', rej: /unknown column name \[extra\]/ },
    { key: 'new:ST2', find: () => ({ extra: { $exists: false } }), exp: 'REJECT', rej: /unknown column name \[extra\]/ },
    { key: 'new:ST3', find: () => ({ $nor: [{ extra: { $ne: null } }] }), exp: 'REJECT', rej: /unknown column name \[extra\]/ },
    { key: 'new:ST4', find: () => ({ name: 'abc' }), exp: 'g' }, //未引用該欄者照常
]


//opt.pk非model之屬性(大小寫不符)時, 主鍵名之鍵不得繞過嚴格鍵(reladb契約第三條)
const CASES_OPTPK = [
    { key: 'new:OK1', find: () => ({ ID: 'a' }), exp: 'REJECT', wopt: { pk: 'ID' }, rej: /unknown column name \[ID\]/ },
    { key: 'new:OK2', find: () => ({ ID: { $ne: 'a' } }), exp: 'REJECT', wopt: { pk: 'ID' }, rej: /unknown column name \[ID\]/ },
]


if (isWindows()) {
    describe('WOrmMdb find keys(S、K、D、B、PK、嚴格鍵、Symbol鍵、length鍵)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-keys', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-keys`)
        })

        for (let c of [...CASES, ...CASES_OPTPK]) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })

    describe('WOrmMdb find keys(model有而資料表無之欄)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-keys-stale', 'tc', {
                patchModel: (src) => src.replace('\'name\': {', '\'extra\': {\ntype: DataTypes.STRING,\nallowNull: true\n},\n\'name\': {'),
            })
        })

        after(function() {
            cleanStorage(`./test/temp-find-keys-stale`)
        })

        for (let c of CASES_STALE) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
