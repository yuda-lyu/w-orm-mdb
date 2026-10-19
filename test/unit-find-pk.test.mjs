import Sequelize from 'sequelize'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(系列條件白名單, 第 33 項批 2)、R-FIND-03(castPkFind 僅處理白名單)與 R-PK-03/05
//本檔: 審計複審之 rv:A(主鍵欄 $not 已移除, 以白名單內運算子表達之可攜寫法)、rv:B(非主鍵欄與 cvFind 分支)、rv:C(主鍵條件位於深層邏輯)、rv2:D($not 與 Op.not 並存已移除)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收(rej 為訊息須符合之原因); 每列之斷言見 unit-find-setup.mjs 之 runCase
//註: 註解中「1.0.36」為第 33 項批 2 之前版本之行為, 供破壞性變更對照; 白名單內之可攜寫法以 P 結尾之 key 標示


let Op = Sequelize.Op

function but(...xs) {
    return butAll(ALL, ...xs)
}

const L300 = 'z'.repeat(300)

const OP = (nm) => new RegExp(`unsupported operator \\[\\${nm}\\]`) //白名單外之運算子, 原因詞彙取自 wsemi cvOrmFind
const SYM = /symbol key is not allowed/

//每次讀值結果不同之getter: 白名單拒收存取器(1.0.36 以快照令每個值只讀一次; 「檢查之值即使用之值」之 Proxy 版見 unit-find-wlx.test.mjs)
function flipGetter() {
    let n = 0
    return {
        get id() {
            n++
            return n === 1 ? { $ne: 'a' } : { $ne: 'b' }
        },
    }
}

function nonEnum(k, v) {
    let o = {}
    Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    return o
}


const CASES = [
    //rv:A 主鍵欄 $not 已移除(白名單外); 1.0.36 為整體取反 NOT(A∧B)。白名單內之等價寫法以 P 標示(主鍵等值類條件仍由 Jet 判定, R-PK-05)
    { key: 'rv:A1', find: () => ({ id: { $not: { $not: { $ne: 'A ' } } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)
    { key: 'rv:A1P', find: () => ({ id: { $ne: 'A ' } }), exp: but('a') }, //Jet變體(大小寫+尾端空白)由Jet判定
    { key: 'rv:A2', find: () => ({ id: { $not: { $not: { $ne: '' } } } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'rv:A2P', find: () => ({ id: { $ne: '' } }), exp: 'REJECT', rej: /invalid find: invalid primary key value in negative condition at \[find\.id\.\$ne\]/ }, //否定語境之無效主鍵值reject(R-PK-03 4b), 不得推得全部命中而清空全表
    { key: 'rv:A3', find: () => ({ id: { $not: { $not: 'A ' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a
    { key: 'rv:A4', find: () => ({ id: { $not: { $not: { $nin: ['A ', 'Ｂ'] } } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a,b)
    { key: 'rv:A4P', find: () => ({ id: { $nin: ['A ', 'Ｂ'] } }), exp: but('a', 'b') }, //全形Ｂ與b視為同鍵(Jet)
    { key: 'rv:A5', find: () => ({ id: { [Op.not]: { [Op.not]: { [Op.ne]: '' } } } }), exp: 'REJECT', rej: SYM }, //Symbol Op形式已移除
    { key: 'rv:A6', find: () => ({ id: { $not: { $in: ['a', 'b'], $gte: 'b' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(b)
    { key: 'rv:A6P', find: () => ({ id: { $in: ['a', 'b'], $lt: 'b' } }), exp: 'a' }, //同欄多運算子為AND
    { key: 'rv:A7', find: () => ({ id: { $not: { $eq: 'a', $ne: 'b' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)
    { key: 'rv:A7P', find: () => ({ id: { $eq: 'a', $ne: 'b' } }), exp: 'a' },
    { key: 'rv:A8', find: () => ({ id: { $not: { $gt: L300 } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 為全部
    { key: 'rv:A8P', find: () => ({ id: { $gt: L300 } }), exp: '' }, //已知限制(外審opus F2, 待主控裁示): 範圍界限為不可能存在之主鍵值(超過255字元)者恆不命中(同1.0.35); 嚴格語意上 id > 300個z 亦為無命中, 但 id < 300個z 應為全部(見rv:A9)
    { key: 'rv:A8b', find: () => ({ $not: { id: { $gt: L300 } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 為全部
    { key: 'rv:A8c', find: () => ({ $nor: [{ id: { $gt: L300 } }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 為全部
    { key: 'rv:A9', find: () => ({ id: { $lt: L300 } }), exp: '' }, //已知限制(外審opus F2, 待主控裁示): 同1.0.35恆不命中; 嚴格語意應為全部列(字串序皆小於300個z), 此斷言記錄現況而非應然
    { key: 'rv:A10', find: () => ({ id: { $not: [] } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 主鍵$not陣列即$nin, 空即恆成立而全部
    { key: 'rv:A11', find: () => ({ id: { $not: ['A '] } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)
    { key: 'rv:A12', find: flipGetter, exp: 'REJECT', rej: /accessor/ }, //存取器一律reject(1.0.36 以快照令值只讀一次而命中 but(a))
    { key: 'rv:A13', find: () => ({ id: { $not: { $regex: '_' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(x_1)
    { key: 'rv:A14', find: () => ({ id: { $not: { $regex: 'X', $options: 'i' }, $in: ['x_1', 'a'] } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a

    //rv:B 非主鍵欄與 cvFind 分支
    { key: 'rv:B1', find: () => ({ nocol: { $nin: [] } }), exp: 'REJECT', rej: /with empty array/ }, //空$nin 在白名單外(形狀層先於欄名)
    { key: 'rv:B2', find: () => ({ nocol: { $in: [] } }), exp: 'REJECT', rej: /unknown column name/ }, //不存在之欄: 嚴格鍵reject
    { key: 'rv:B3', find: () => ({ nocol: { $not: { $in: [] } } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'rv:B4', find: () => ({ value: { $gt: 1, [Op.gt]: 5 } }), exp: 'REJECT', rej: SYM }, //Symbol Op已移除; 1.0.36 同義鍵各自成子式命中 i,j,x_1
    { key: 'rv:B5', find: () => ({ name: { $in: ['abc'], [Op.in]: ['peter'] } }), exp: 'REJECT', rej: SYM },
    { key: 'rv:B6', find: () => ({ id: { $in: ['a', 'b'], [Op.in]: ['b', 'c'] } }), exp: 'REJECT', rej: SYM }, //1.0.36 主鍵同義鍵並存命中 b
    { key: 'rv:B7', find: () => nonEnum('id', 'a'), exp: 'REJECT', rej: /non-enumerable/ }, //不可列舉之鍵reject(1.0.36 以Reflect.ownKeys納入而命中 a)
    { key: 'rv:B8', find: () => nonEnum('name', 'abc'), exp: 'REJECT', rej: /non-enumerable/ }, //1.0.36 命中 g
    { key: 'rv:B9', find: () => Object.assign(Object.create(null), { id: 'a' }), exp: 'a' }, //原型為null之一般物件
    { key: 'rv:B10', find: () => Object.create(null), exp: ALL }, //原型為null之空物件: 全部
    { key: 'rv:B11', find: () => JSON.parse('{"constructor":"x"}'), exp: 'REJECT', rej: /unsupported column name/ }, //Object.prototype成員名: 符合欄名文法, 由reladb之cvFind reject
    { key: 'rv:B12', find: () => ({ dt: { $gte: new Date(2026, 0, 1), $lt: new Date(2026, 5, 1) } }), exp: 'a' },
    { key: 'rv:B13', find: () => ({ dt: { $in: [new Date(2026, 0, 1), null] } }), exp: 'REJECT', rej: /null is not allowed here/ }, //$in元素不收null(1.0.36 命中 a,c,e,f,g,h,i,j,x_1)
    { key: 'rv:B13P', find: () => ({ $or: [{ dt: new Date(2026, 0, 1) }, { dt: null }] }), exp: 'a,c,e,f,g,h,i,j,x_1' }, //B13之可攜寫法(含NULL)
    { key: 'rv:B14', find: () => ({ value: { $in: [2, '3'] } }), exp: 'b,c,f' },
    { key: 'rv:B15', find: () => ({ value: { $in: [2, 'abc'] } }), exp: 'REJECT' }, //數值欄收非數值字串: 後端型別檢核reject
    { key: 'rv:B16', find: () => ({ value: { $in: [2, true] } }), exp: 'REJECT' }, //數值欄收布林: 後端型別檢核reject
    { key: 'rv:B17', find: () => ({ value: /1/ }), exp: 'REJECT', rej: /unsupported value type/ }, //RegExp值已移除
    { key: 'rv:B18', find: () => ({ dt: /2026/ }), exp: 'REJECT', rej: /unsupported value type/ },
    { key: 'rv:B19', find: () => ({ name: { $regex: 'pet', $not: { $options: 'i' } } }), exp: 'REJECT', rej: OP('$regex') },

    //rv:C 主鍵條件位於深層邏輯(白名單僅 $and、$or; $nor、Op.not、文件層與欄位層 $not 已移除)
    { key: 'rv:C1', find: () => ({ $nor: [{ $or: [{ id: 'A ' }, { value: { $gt: 7 } }] }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 命中 b,c,e,f,g,h,i
    { key: 'rv:C1P', find: () => ({ $and: [{ id: { $ne: 'A ' } }, { value: { $lte: 7 } }] }), exp: 'b,c,e,f,g,h,i' }, //C1之可攜寫法(NOR=各子式取反之AND, 且非NULL)
    { key: 'rv:C2', find: () => ({ [Op.not]: { $or: [{ id: 'A ' }, { id: 'Ｂ' }] } }), exp: 'REJECT', rej: SYM }, //1.0.36 命中 but(a,b)
    { key: 'rv:C2P', find: () => ({ $and: [{ id: { $ne: 'A ' } }, { id: { $ne: 'Ｂ' } }] }), exp: but('a', 'b') },
    { key: 'rv:C3', find: () => ({ $nor: [{ id: { $in: ['a', null] } }] }), exp: 'REJECT', rej: OP('$nor') },
    { key: 'rv:C4', find: () => ({ $or: [{ id: { $in: ['a', null] } }, { name: 'abc' }] }), exp: 'REJECT', rej: /null is not allowed here/ }, //$in元素不收null(1.0.36 命中 a,g)
    { key: 'rv:C4P', find: () => ({ $or: [{ id: { $in: ['a', 'zz'] } }, { name: 'abc' }] }), exp: 'a,g' }, //主鍵 $in 之不存在值不命中
    { key: 'rv:C5', find: () => ({ $not: {} }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 NOT(恆真)無命中
    { key: 'rv:C6', find: () => ({ $not: { $and: [] } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'rv:C7', find: () => ({ $not: [{ id: 'a' }] }), exp: 'REJECT', rej: OP('$not') }, //1.0.35誤刪
    { key: 'rv:C8', find: () => ({ $nor: [{ id: { $not: 'A ' } }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 命中 a
    { key: 'rv:C9', find: () => ({ $and: [{ id: { $ne: 'A ' } }, { $nor: [{ id: 'Ｂ' }] }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 命中 but(a,b)
    { key: 'rv:C10', find: () => ({ $nor: [{ [Op.and]: [{ $or: [{ id: 'A ' }] }] }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 命中 but(a)
    { key: 'rv:C11P', find: () => ({ $and: [{ $or: [{ id: 'a' }, { id: { $ne: 'b' } }] }, { value: { $gt: 0 } }] }), exp: 'a,c,e,f,i,j,x_1' }, //新增: 主鍵條件位於 $and 內之 $or(各層皆經 castPkFind 以字串鍵$and包覆)
    { key: 'new:NL1', find: () => ({ $and: [{ $not: { name: 'abc' } }] }), exp: 'REJECT', rej: OP('$not') }, //文件層$not(Q2 保留功能)已移除; 1.0.36 命中 but(e,g)
    { key: 'new:NL2', find: () => ({ $or: [{ $not: { id: 'A ' } }, { value: 0 }] }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)

    //rv2:D 主鍵欄 $not 與 Op.not 並存: 皆已移除
    { key: 'rv2:D1', find: () => ({ id: { $not: { $gt: 'w' }, [Op.not]: { $lt: 'b' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 b,c,d,e,f,g,h,i,j
    { key: 'rv2:D2', find: () => ({ id: { $not: /a/, [Op.not]: /x/ } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'rv2:D3', find: () => ({ id: { $not: { $in: ['a'], $nin: ['b'] } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)
    { key: 'rv2:D4', find: () => ({ id: { $not: { $gt: 'w' }, [Op.not]: 'a' } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'rv2:D5', find: () => ({ value: { $not: { $gt: 5 }, [Op.not]: { $lt: 1 } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a,b,c,e,f
]


if (isWindows()) {
    describe('WOrmMdb find pk(主鍵條件改寫、cvFind分支、深層邏輯與已移除之$not)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-pk', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-pk`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
