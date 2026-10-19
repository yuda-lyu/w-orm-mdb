import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(系列條件白名單, 第 33 項批 2)與 R-FIND(非主鍵條件依 w-orm-reladb 1.1.10 帳本, 主鍵條件依本套件 R-PK-03/05)
//本檔: R 組($regex/$options, 白名單外)、N 組($not, 白名單外與可攜寫法)、L 組(邏輯)、X 組(其他 MongoDB 運算子與未知運算子)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收(rej 為訊息須符合之原因); 每列之斷言見 unit-find-setup.mjs 之 runCase
//註: 註解中「1.0.36」為第 33 項批 2 之前版本之行為, 供破壞性變更對照


function but(...xs) {
    return butAll(ALL, ...xs)
}

//陣列之洞
function sparse(a, b) {
    let arr = [a]
    arr[2] = b
    return arr
}

const OP = (nm) => new RegExp(`unsupported operator \\[\\${nm}\\]`) //白名單外之運算子, 原因詞彙取自 wsemi cvOrmFind


const CASES = [
    //R: $regex、$options 不在白名單, 一律 reject(1.0.36 為字面子字串; dspec〈一之三〉5.)
    { key: 'R1', find: () => ({ name: { $regex: 'pet' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 a,b
    { key: 'R2', find: () => ({ name: { $regex: 'pet', $options: 'i' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 a,b
    { key: 'R3', find: () => ({ name: { $regex: '^pe' } }), exp: 'REJECT', rej: OP('$regex') },
    { key: 'R4', find: () => ({ name: { $regex: 'a.c' } }), exp: 'REJECT', rej: OP('$regex') },
    { key: 'R5', find: () => ({ name: { $regex: '_' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 c
    { key: 'R6', find: () => ({ name: { $regex: '%' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 d
    { key: 'R7', find: () => ({ name: { $regex: /pet/i } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 a,b
    { key: 'R8', find: () => ({ name: { $regex: 'PeT', $options: '$i' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 a,b
    { key: 'R9', find: () => ({ name: { $regex: '\\[a-c\\]' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 i
    { key: 'R10', find: () => ({ id: { $regex: '%' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 主鍵$regex留原欄: 無命中
    { key: 'R11', find: () => ({ id: { $regex: '_' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 x_1
    { key: 'R12', find: () => ({ name: { $regex: 'é', $options: 'i' } }), exp: 'REJECT', rej: OP('$regex') },
    { key: 'R13', find: () => ({ name: { $regex: '!' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 j
    { key: 'R14', find: () => ({ name: { $options: 'i' } }), exp: 'REJECT', rej: OP('$options') },
    { key: 'R15', find: () => ({ value: { $regex: '1' } }), exp: 'REJECT', rej: OP('$regex') },
    { key: 'R16', find: () => ({ name: { $regex: 'a\\.c' } }), exp: 'REJECT', rej: OP('$regex') }, //1.0.36 命中 f
    { key: 'R17', find: () => ({ name: { $regex: '[' } }), exp: 'REJECT', rej: OP('$regex') },

    //N: $not 不在白名單(欄位層與文件層), 一律 reject(1.0.36 為 NOT 子式; 文件層 $not 為保留功能)
    { key: 'N1', find: () => ({ value: { $not: { $gt: 2 } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a,b,f,g,h
    { key: 'N2', find: () => ({ name: { $not: /pet/i } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 c,d,f,g,h,i,j,x_1
    { key: 'N3', find: () => ({ value: { $not: 2 } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a,c,e,g,h,i,j,x_1
    { key: 'N4', find: () => ({ $not: { id: 'a' } }), exp: 'REJECT', rej: OP('$not') }, //文件層$not(Q2 保留功能)已移除; 1.0.36 命中 but(a)
    { key: 'N5', find: () => ({ id: { $not: { $gt: 'b' } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a,b
    { key: 'N6', find: () => ({ n: { $not: { $gt: 2 } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 a,b,f,g,h
    { key: 'N7', find: () => ({ name: { $not: { $in: [null] } } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(e)
    { key: 'N8', find: () => ({ name: { $not: { $foo: 1 } } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'N9', find: () => ({ id: { $not: 'a' } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(a)
    { key: 'N10', find: () => ({ name: { $not: ['abc'] } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'N11', find: () => ({ $not: { name: 'abc' } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(e,g)

    //NP: 上列$not 之可攜寫法(以白名單內之運算子表達, 皆不含NULL列, 與1.0.36 之 NOT 子式命中相同)
    { key: 'NP1', find: () => ({ value: { $lte: 2 } }), exp: 'a,b,f,g,h' }, //取代 N1: NOT(value>2) 且非NULL
    { key: 'NP2', find: () => ({ n: { $lte: 2 } }), exp: 'a,b,f,g,h' }, //取代 N6
    { key: 'NP3', find: () => ({ id: { $lte: 'b' } }), exp: 'a,b' }, //取代 N5: 主鍵範圍運算子
    { key: 'NP4', find: () => ({ id: { $ne: 'a' } }), exp: but('a') }, //取代 N9、N4: 主鍵 $ne 由 Jet 判定
    { key: 'NP5', find: () => ({ $and: [{ name: { $ne: null } }, { name: { $ne: 'abc' } }] }), exp: but('e', 'g') }, //取代 N11: 排除NULL之可攜寫法
    { key: 'NP6', find: () => ({ $or: [{ name: null }, { name: { $ne: 'abc' } }] }), exp: but('g') }, //含NULL之可攜寫法

    //L: 邏輯(白名單僅 $and、$or; 元素須為非空條件物件, 清單須非空)
    { key: 'L1', find: () => ({ $and: [{ value: { $gte: 1 } }, { value: { $lte: 2 } }] }), exp: 'a,b,f' },
    { key: 'L2', find: () => ({ $or: [{ id: 'a' }, { id: 'c' }] }), exp: 'a,c' },
    { key: 'L3', find: () => ({ $nor: [{ id: 'a' }, { id: 'c' }] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 命中 but(a,c)
    { key: 'L4', find: () => ({ $or: [{ $and: [{ value: { $gt: 0 } }, { name: { $ne: null } }] }, { id: 'e' }] }), exp: 'a,b,c,e,f,i,j,x_1' },
    { key: 'L5', find: () => ({ $and: [] }), exp: 'REJECT', rej: /with empty array/ }, //空邏輯陣列reject(系列最低要求③; 1.0.35刪光全表)
    { key: 'L6', find: () => ({ $or: [] }), exp: 'REJECT', rej: /with empty array/ },
    { key: 'L7', find: () => ({ $and: [{ id: 'a' }], value: 1 }), exp: 'a' },
    { key: 'L8', find: () => ({ $nor: [{}] }), exp: 'REJECT', rej: OP('$nor') }, //1.0.36 為無命中
    { key: 'L9', find: () => ({ $or: [{}] }), exp: 'REJECT', rej: /empty condition/ }, //1.0.36 為全部
    { key: 'L10', find: () => ({ $and: [{}] }), exp: 'REJECT', rej: /empty condition/ }, //1.0.36 為全部
    { key: 'L11', find: () => ({ $and: [], id: 'a' }), exp: 'REJECT', rej: /with empty array/ }, //空$and不得被主鍵條件掩蓋(R-FIND-03)
    { key: 'L12', find: () => ({ $nor: [] }), exp: 'REJECT', rej: OP('$nor') },
    { key: 'L13', find: () => ({ $or: [{ name: 'abc' }, { name: { $foo: 1 } }] }), exp: 'REJECT', rej: OP('$foo') },
    { key: 'L14', find: () => ({ $and: { id: 'a' } }), exp: 'REJECT', rej: /value must be an array/ }, //邏輯運算子之值非陣列reject
    { key: 'L15', find: () => ({ $or: sparse({ id: 'a' }, { id: 'b' }) }), exp: 'REJECT', rej: /sparse array hole/ }, //陣列之洞reject

    //X: 其他 MongoDB 運算子與未知運算子(白名單外一律 reject)
    { key: 'X1', find: () => ({ name: { $exists: true } }), exp: 'REJECT', rej: OP('$exists') }, //1.0.36 命中 but(e)
    { key: 'X2', find: () => ({ name: { $exists: false } }), exp: 'REJECT', rej: OP('$exists') }, //1.0.36 命中 e
    { key: 'X3', find: () => ({ value: { $type: 'number' } }), exp: 'REJECT', rej: OP('$type') },
    { key: 'X4', find: () => ({ value: { $mod: [2, 0] } }), exp: 'REJECT', rej: OP('$mod') },
    { key: 'X5', find: () => ({ name: { $size: 3 } }), exp: 'REJECT', rej: OP('$size') },
    { key: 'X6', find: () => ({ value: { $all: [1] } }), exp: 'REJECT', rej: OP('$all') },
    { key: 'X7', find: () => ({ value: { $elemMatch: { $gt: 1 } } }), exp: 'REJECT', rej: OP('$elemMatch') },
    { key: 'X8', find: () => ({ value: { $foo: 1 } }), exp: 'REJECT', rej: OP('$foo') }, //1.0.35靜默不命中
    { key: 'X9', find: () => ({ $foo: 1 }), exp: 'REJECT', rej: OP('$foo') },
    { key: 'X10', find: () => ({ $where: 'this.value>1' }), exp: 'REJECT', rej: OP('$where') },
    { key: 'X11', find: () => ({ $expr: { $gt: ['$value', 1] } }), exp: 'REJECT', rej: OP('$expr') },
    { key: 'X12', find: () => ({ dt: { $foo: 1 } }), exp: 'REJECT', rej: OP('$foo') }, //1.0.35把運算子物件stringify為今日而刪除d
    { key: 'X13', find: () => ({ n: { $foo: 1 } }), exp: 'REJECT', rej: OP('$foo') },
    { key: 'X14', find: () => ({ b: { $foo: 1 } }), exp: 'REJECT', rej: OP('$foo') },
    { key: 'X15', find: () => ({ id: { $foo: 1 } }), exp: 'REJECT', rej: OP('$foo') }, //主鍵欄未知運算子由 cvOrmFind 先拒(castPkFind 前)
    { key: 'X16', find: () => ({ id: { $exists: true } }), exp: 'REJECT', rej: OP('$exists') }, //1.0.36 為全部
    { key: 'X17', find: () => ({ name: { $exists: 2 } }), exp: 'REJECT', rej: OP('$exists') },
]


if (isWindows()) {
    describe('WOrmMdb find ops(R、N、L、X)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-ops', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-ops`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
