import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-FIND(非主鍵條件依 w-orm-reladb 1.1.9 帳本 R1–R6, 主鍵條件依本套件 R-PK-03/05)
//本檔: R 組($regex)、N 組($not)、L 組(邏輯)、X 組(其他 MongoDB 運算子與未知運算子)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


function but(...xs) {
    return butAll(ALL, ...xs)
}

//陣列之洞
function sparse(a, b) {
    let arr = [a]
    arr[2] = b
    return arr
}


const CASES = [
    //R: $regex 為字面子字串, LIKE 特殊字元跳脫, $options 只收 i(reladb R6; R-FIND-04)
    { key: 'R1', find: () => ({ name: { $regex: 'pet' } }), exp: 'a,b' }, //未給i: 大小寫依定序(NOCASE)
    { key: 'R2', find: () => ({ name: { $regex: 'pet', $options: 'i' } }), exp: 'a,b' },
    { key: 'R3', find: () => ({ name: { $regex: '^pe' } }), exp: 'REJECT' }, //未跳脫之元字元reject
    { key: 'R4', find: () => ({ name: { $regex: 'a.c' } }), exp: 'REJECT' },
    { key: 'R5', find: () => ({ name: { $regex: '_' } }), exp: 'c' }, //_為字面(1.0.35為萬用字元而誤刪)
    { key: 'R6', find: () => ({ name: { $regex: '%' } }), exp: 'd' }, //%為字面
    { key: 'R7', find: () => ({ name: { $regex: /pet/i } }), exp: 'a,b' },
    { key: 'R8', find: () => ({ name: { $regex: 'PeT', $options: '$i' } }), exp: 'a,b' }, //'$i'過渡期視同i
    { key: 'R9', find: () => ({ name: { $regex: '\\[a-c\\]' } }), exp: 'i' }, //跳脫之元字元為字面
    { key: 'R10', find: () => ({ id: { $regex: '%' } }), exp: '' }, //主鍵$regex留原欄交cvFind(R-FIND-03)
    { key: 'R11', find: () => ({ id: { $regex: '_' } }), exp: 'x_1' },
    { key: 'R12', find: () => ({ name: { $regex: 'é', $options: 'i' } }), exp: 'REJECT' }, //sqlite給i且非ASCII字母reject
    { key: 'R13', find: () => ({ name: { $regex: '!' } }), exp: 'j' }, //跳脫字元本身為字面
    { key: 'R14', find: () => ({ name: { $options: 'i' } }), exp: 'REJECT' }, //$options無$regex reject
    { key: 'R15', find: () => ({ value: { $regex: '1' } }), exp: 'REJECT' }, //非字串欄reject
    { key: 'R16', find: () => ({ name: { $regex: 'a\\.c' } }), exp: 'f' },
    { key: 'R17', find: () => ({ name: { $regex: '[' } }), exp: 'REJECT' },

    //N: $not(reladb R5; 主鍵欄 $not 與頂層 $not 依 R-FIND-03)
    { key: 'N1', find: () => ({ value: { $not: { $gt: 2 } } }), exp: 'a,b,f,g,h' }, //NOT(value>2)不含NULL列(1.0.35命中全部非NULL列)
    { key: 'N2', find: () => ({ name: { $not: /pet/i } }), exp: 'c,d,f,g,h,i,j,x_1' },
    { key: 'N3', find: () => ({ value: { $not: 2 } }), exp: 'a,c,e,g,h,i,j,x_1' },
    { key: 'N4', find: () => ({ $not: { id: 'a' } }), exp: but('a') }, //頂層$not本輪保留(Q2)
    { key: 'N5', find: () => ({ id: { $not: { $gt: 'b' } } }), exp: 'a,b' },
    { key: 'N6', find: () => ({ n: { $not: { $gt: 2 } } }), exp: 'a,b,f,g,h' },
    { key: 'N7', find: () => ({ name: { $not: { $in: [null] } } }), exp: but('e') },
    { key: 'N8', find: () => ({ name: { $not: { $foo: 1 } } }), exp: 'REJECT' }, //未知運算子reject(系列最低要求②)
    { key: 'N9', find: () => ({ id: { $not: 'a' } }), exp: but('a') },
    { key: 'N10', find: () => ({ name: { $not: ['abc'] } }), exp: 'REJECT' }, //非主鍵$not陣列reject(reladb R5)
    { key: 'N11', find: () => ({ $not: { name: 'abc' } }), exp: but('e', 'g') }, //頂層$not(Q2)

    //L: 邏輯(reladb R3)
    { key: 'L1', find: () => ({ $and: [{ value: { $gte: 1 } }, { value: { $lte: 2 } }] }), exp: 'a,b,f' },
    { key: 'L2', find: () => ({ $or: [{ id: 'a' }, { id: 'c' }] }), exp: 'a,c' },
    { key: 'L3', find: () => ({ $nor: [{ id: 'a' }, { id: 'c' }] }), exp: but('a', 'c') },
    { key: 'L4', find: () => ({ $or: [{ $and: [{ value: { $gt: 0 } }, { name: { $ne: null } }] }, { id: 'e' }] }), exp: 'a,b,c,e,f,i,j,x_1' },
    { key: 'L5', find: () => ({ $and: [] }), exp: 'REJECT' }, //空邏輯陣列reject(系列最低要求③; 1.0.35刪光全表)
    { key: 'L6', find: () => ({ $or: [] }), exp: 'REJECT' },
    { key: 'L7', find: () => ({ $and: [{ id: 'a' }], value: 1 }), exp: 'a' },
    { key: 'L8', find: () => ({ $nor: [{}] }), exp: '' }, //{}子式為恆真
    { key: 'L9', find: () => ({ $or: [{}] }), exp: ALL },
    { key: 'L10', find: () => ({ $and: [{}] }), exp: ALL },
    { key: 'L11', find: () => ({ $and: [], id: 'a' }), exp: 'REJECT' }, //空$and不得被主鍵條件掩蓋(R-FIND-03)
    { key: 'L12', find: () => ({ $nor: [] }), exp: 'REJECT' },
    { key: 'L13', find: () => ({ $or: [{ name: 'abc' }, { name: { $foo: 1 } }] }), exp: 'REJECT' },
    { key: 'L14', find: () => ({ $and: { id: 'a' } }), exp: 'REJECT' }, //邏輯運算子之值非陣列reject
    { key: 'L15', find: () => ({ $or: sparse({ id: 'a' }, { id: 'b' }) }), exp: 'REJECT' }, //陣列之洞reject(reladb R4)

    //X: 其他 MongoDB 運算子與未知運算子(reladb R3)
    { key: 'X1', find: () => ({ name: { $exists: true } }), exp: but('e') },
    { key: 'X2', find: () => ({ name: { $exists: false } }), exp: 'e' },
    { key: 'X3', find: () => ({ value: { $type: 'number' } }), exp: 'REJECT' },
    { key: 'X4', find: () => ({ value: { $mod: [2, 0] } }), exp: 'REJECT' },
    { key: 'X5', find: () => ({ name: { $size: 3 } }), exp: 'REJECT' },
    { key: 'X6', find: () => ({ value: { $all: [1] } }), exp: 'REJECT' },
    { key: 'X7', find: () => ({ value: { $elemMatch: { $gt: 1 } } }), exp: 'REJECT' },
    { key: 'X8', find: () => ({ value: { $foo: 1 } }), exp: 'REJECT' }, //1.0.35靜默不命中
    { key: 'X9', find: () => ({ $foo: 1 }), exp: 'REJECT' },
    { key: 'X10', find: () => ({ $where: 'this.value>1' }), exp: 'REJECT' },
    { key: 'X11', find: () => ({ $expr: { $gt: ['$value', 1] } }), exp: 'REJECT' },
    { key: 'X12', find: () => ({ dt: { $foo: 1 } }), exp: 'REJECT' }, //1.0.35把運算子物件stringify為今日而刪除d
    { key: 'X13', find: () => ({ n: { $foo: 1 } }), exp: 'REJECT' },
    { key: 'X14', find: () => ({ b: { $foo: 1 } }), exp: 'REJECT' },
    { key: 'X15', find: () => ({ id: { $foo: 1 } }), exp: 'REJECT' }, //主鍵欄未知運算子留原欄交cvFind拒收
    { key: 'X16', find: () => ({ id: { $exists: true } }), exp: ALL },
    { key: 'X17', find: () => ({ name: { $exists: 2 } }), exp: 'REJECT' },
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
