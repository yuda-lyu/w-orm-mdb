import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(系列條件白名單, 第 33 項批 2)與 R-FIND(非主鍵條件依 w-orm-reladb 1.1.10 帳本, 主鍵條件依本套件 R-PK-03/05)
//本檔: F 組(find 之形式)、V 組(欄位直給之值)、O 組(比較運算子)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


function but(...xs) {
    return butAll(ALL, ...xs)
}

class Cond {
    constructor() {
        this.id = 'a'
    }
}


const CASES = [
    //F: find 之形式(R-FIND-02; reladb R1)
    { key: 'F0', find: () => undefined, noArg: true, exp: ALL }, //未給: 全部(規格:250、:407)
    { key: 'F1', find: () => ({}), exp: ALL }, //{}: 全部
    { key: 'F2', find: () => null, exp: 'REJECT', rej: /condition must be a plain object/ }, //傳了值但不是條件物件一律reject, 不視為{}(dspec〈一之一〉2.; 1.0.36 視為{}而全部)
    { key: 'F3', find: () => [], exp: 'REJECT', rej: /condition must be a plain object/ }, //陣列reject(1.0.36 視為{})
    { key: 'F4', find: () => 'a', exp: 'REJECT', rej: /condition must be a plain object/ }, //字串reject(1.0.36 視為{})
    { key: 'F5', find: () => 123, exp: 'REJECT', rej: /condition must be a plain object/ }, //數值reject(1.0.36 視為{})
    { key: 'F6', find: () => [{ id: 'a' }], exp: 'REJECT', rej: /condition must be a plain object/ }, //條件陣列reject(1.0.36 視為{})
    { key: 'F7', find: () => new Cond(), exp: 'REJECT', rej: /condition must be a plain object/ }, //非一般物件reject
    { key: 'F8', find: () => Object.create({ id: 'a' }), exp: 'REJECT' }, //條件在原型: 非一般物件reject, 不得當{}全刪
    { key: 'F9', find: () => new Date(), exp: 'REJECT' }, //Date作為find: reject
    { key: 'F10', find: () => new Map([['id', 'a']]), exp: 'REJECT' }, //Map作為find: reject

    //V: 欄位直給之值(reladb R4; 主鍵依R-PK-03)
    { key: 'V1', find: () => ({ id: 'a' }), exp: 'a' },
    { key: 'V2', find: () => ({ value: 2 }), exp: 'b,f' },
    { key: 'V3', find: () => ({ name: null }), exp: 'e' }, //null為IS NULL(reladb R5)
    { key: 'V4', find: () => ({ value: 0 }), exp: 'g' },
    { key: 'V5', find: () => ({ name: '' }), exp: 'h' },
    { key: 'V6', find: () => ({ id: 'A' }), exp: 'a' }, //主鍵大小寫由Jet判定(R-PK-00)
    { key: 'V7', find: () => ({ value: '2' }), exp: 'b,f' }, //數值欄收十進位字串(reladb R4)
    { key: 'V8', find: () => ({ id: ['a', 'b'] }), exp: 'REJECT', rej: /array value is not supported/ }, //陣列值即$in已移除(白名單外; 1.0.36 命中 a,b)
    { key: 'V9', find: () => ({ name: /pet/i }), exp: 'REJECT', rej: /unsupported value type/ }, //RegExp值已移除(1.0.36 即$regex命中 a,b)
    { key: 'V10', find: () => ({ name: undefined }), exp: 'REJECT' }, //undefined值reject(系列最低要求③)
    { key: 'V11', find: () => ({ id: 'a', value: 1 }), exp: 'a' }, //隱式and
    { key: 'V12', find: () => ({ nocol: 1 }), exp: 'REJECT' }, //model未列之欄: 嚴格鍵reject(R-FIND-04)
    { key: 'V13', find: () => ({ 'meta.a': 1 }), exp: 'REJECT' }, //點路徑: 不安全欄名reject
    { key: 'V14', find: () => ({ name: {} }), exp: 'REJECT' }, //非主鍵空物件: reject(reladb R4)
    { key: 'V15', find: () => ({ id: {} }), exp: 'REJECT', rej: /empty operator object/ }, //主鍵空物件: 空運算子物件reject(1.0.36 為無效值而不命中)
    { key: 'V16', find: () => ({ name: { a: 1 } }), exp: 'REJECT' }, //巢狀欄位物件reject
    { key: 'V17', find: () => ({ name: 123 }), exp: 'REJECT' }, //字串欄收數字: 型別不符reject(reladb R4)
    { key: 'V18', find: () => ({ value: 'abc' }), exp: 'REJECT' }, //數值欄收非數值字串reject
    { key: 'V19', find: () => ({ n: '2' }), exp: 'b,f' }, //整數欄收整數字串
    { key: 'V20', find: () => ({ n: 2.5 }), exp: '' }, //整數欄收非整數: 有限數值照比, 無命中
    { key: 'V21', find: () => ({ id: /X_/i }), exp: 'REJECT', rej: /unsupported value type/ }, //主鍵之RegExp值已移除(1.0.36 即$regex命中 x_1)

    //O: 比較運算子(reladb R4、R5)
    { key: 'O1', find: () => ({ id: { $eq: 'a' } }), exp: 'a' },
    { key: 'O2', find: () => ({ name: { $eq: null } }), exp: 'e' },
    { key: 'O3', find: () => ({ value: { $ne: 2 } }), exp: 'a,c,e,g,h,i,j,x_1' }, //$ne不含NULL列(SQL三值, reladb R5)
    { key: 'O4', find: () => ({ name: { $ne: null } }), exp: but('e') },
    { key: 'O5', find: () => ({ value: { $gt: 2 } }), exp: 'c,e,i,j,x_1' },
    { key: 'O6', find: () => ({ value: { $gte: 2 } }), exp: 'b,c,e,f,i,j,x_1' },
    { key: 'O7', find: () => ({ value: { $lt: 2 } }), exp: 'a,g,h' },
    { key: 'O8', find: () => ({ value: { $lte: 2 } }), exp: 'a,b,f,g,h' },
    { key: 'O9', find: () => ({ value: { $gt: 0, $lt: 3 } }), exp: 'a,b,f' },
    { key: 'O10', find: () => ({ name: { $gt: 'p' } }), exp: 'a,b,c,i,x_1' }, //字串欄NOCASE(L4)
    { key: 'O11', find: () => ({ id: { $in: ['a', 'b'] } }), exp: 'a,b' },
    { key: 'O12', find: () => ({ id: { $in: [] } }), exp: '' }, //主鍵空$in: 不命中(R-PK-05)
    { key: 'O13', find: () => ({ name: { $in: [null, 'abc'] } }), exp: 'REJECT', rej: /null is not allowed here/ }, //$in元素不收null(1.0.36 命中 e,g); 可攜寫法: {$or:[{name:null},{name:{$in:['abc']}}]}
    { key: 'O13b', find: () => ({ $or: [{ name: null }, { name: { $in: ['abc'] } }] }), exp: 'e,g' }, //O13之可攜寫法(含NULL)
    { key: 'O14', find: () => ({ id: { $nin: ['a', 'b'] } }), exp: but('a', 'b') },
    { key: 'O15', find: () => ({ id: { $nin: [] } }), exp: 'REJECT', rej: /with empty array/ }, //空$nin reject(1.0.36 主鍵空$nin恆成立而全部)
    { key: 'O16', find: () => ({ value: { $nin: [1, 2] } }), exp: 'c,e,g,h,i,j,x_1' },
    { key: 'O17', find: () => ({ name: { $nin: [null] } }), exp: 'REJECT', rej: /null is not allowed here/ }, //$nin元素不收null(1.0.36 即IS NOT NULL); 可攜寫法: {name:{$ne:null}}(O4)
    { key: 'O18', find: () => ({ value: { $lt: 'abc' } }), exp: 'REJECT' }, //數值欄比非數值字串: reject(1.0.35誤刪)
    { key: 'O19', find: () => ({ name: { $in: ['PETER'] } }), exp: 'a,b' }, //NOCASE
    { key: 'O20', find: () => ({ n: { $in: ['2'] } }), exp: 'b,f' },
    { key: 'O21', find: () => ({ name: { $nin: ['abc', null] } }), exp: 'REJECT', rej: /null is not allowed here/ }, //$nin元素不收null(1.0.36 命中 but(e,g)); 可攜寫法: {$and:[{name:{$ne:null}},{name:{$nin:['abc']}}]}
    { key: 'O21b', find: () => ({ $and: [{ name: { $ne: null } }, { name: { $nin: ['abc'] } }] }), exp: but('e', 'g') }, //O21之可攜寫法(排除NULL)
]


if (isWindows()) {
    describe('WOrmMdb find basic(F、V、O)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-basic', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-basic`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
