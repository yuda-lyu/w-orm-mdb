import assert from 'assert'
import { importSrc } from './tools/srcDir.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: sgud/rule/rulebook_data.md 之 R-READABLE(第557項, w-orm系列規則二: 讀取即拋錯之輸入依原失敗通道拒絕, 改用wsemi之chkReadable)
//  U1 呼叫端給的資料容器(data)、選項(建構opt與各方法之option)、selectByPk之pk, 其判斷函數(iseobj、isearr、isestr、isbol、normPk)判為無效之分支內,
//     以chkReadable分辨「不可讀」(已撤銷之Proxy、Symbol.toStringTag拋錯者、ownKeys陷阱拋錯者)與「可讀而型別不符」; 探針置於判斷之後, 有效輸入不多讀
//  U2 不可讀者走原失敗通道並以固定詞彙invalid <名稱>: must be a readable value(不含原例外文字與值):
//     寫入入口(insert、insertBulk、save、del)之data: 發出一次error事件(data為null)後reject, 資料庫不變;
//     option: 同上(名稱option); selectByPk之pk: 同上(名稱pk); 建構: 同步throw(invalid opt: …、invalid opt.<名>: …)
//  U3 可讀而型別不符者照既有處理: data為5或null時resolve n為0(save與del為[]); 建構之opt成員為5、String包裝物件、空字串等取預設值(K3); selectByPk(5)回null
//  U4 存取器拋錯(A2; 容器可讀而其成員為拋錯之getter或僅對字串鍵拋錯之get陷阱, chkReadable不呼叫存取器)轉固定詞彙invalid option.<成員名>: …、invalid opt.<成員名>: …,
//     不轉出存取器拋出之文字; option成員之getter拋錯與option不可讀同走入口階段(error事件恰一次後reject, data為null); 建構同步throw;
//     例外(主控裁, dspec C15): 建構opt.logDetail與opt.funLog之存取器或get陷阱拋錯者視為未給(用預設), 建構成功(由wsemi之getDiag處置, 案例見unit-diaglog-wo), 其餘11個選項名稱仍建構同步throw;
//     自訂鍵之成員拋錯者名稱以opt計(不回顯鍵名)
//  U5 複製階段(cloneDeep與攤平, A3)之不可讀值——頂層或巢狀(列之id與欄位值、陣列之元素、列之getter、u8a欄)、不論原因(原型為null之Date、過深之巢狀)——
//     一律轉固定詞彙invalid data: must be a readable value, 與頂層不可讀同通道(error事件恰一次、data為null後reject, 資料庫不變), 不補值; 複製處之catch不分辨頂層與巢狀;
//     複製之後才讀取之原型上之存取器所拋者屬外來錯誤之診斷出口, 不擴大(維持原樣, 見rulebook_readable.md已知限制)
//  U8 P4: 複製成功而判斷函數(iseobj、isearr)判為無效者(原型鏈為ownKeys或getPrototypeOf陷阱拋錯之Proxy: cloneDeep不讀原型鏈而成功, iseobj之for...in才拋錯; 複本之length讀取拋錯之陣列), 於判無效之分支內以chkReadable(d, { elements: 'first' }, 標籤為[object Object]者另加ownKeys)分辨:
//     不可讀者同U5(固定詞彙invalid data、error事件恰一次且data為null、資料庫不變), 可讀而型別不符者(空物件、空陣列、Map、Date、型別陣列等)照既有回空結果; 有效輸入不探(不多讀)
//  U6 find(select、delAll)之不可讀由wsemi之cvOrmFind處置(invalid find: …, error事件恰一次), 核實不改
//  U7 A5: selectByPk之不可讀pk reject固定詞彙invalid pk(error事件恰一次、data為null); 可讀而非有效者回null; pk與option皆不可讀時先報pk(讀取次序)
//註: 本檔以importSrc取受測之src, 可以WORM_SRC_DIR指向修改前之src做[修前紅]


const nm = 'readable'
const MSG_DATA = 'invalid data: must be a readable value'
const MSG_OPTION = 'invalid option: must be a readable value'
const MSG_PK = 'invalid pk: must be a readable value'
const MSG_OPT = 'invalid opt: must be a readable value'
const MSG_OPTION_INSTANCE = 'invalid option.instance: must be a readable value'


function revoked() {
    let r = Proxy.revocable({}, {})
    r.revoke()
    return r.proxy
}
function boom(msg) {
    throw new Error(msg)
}
function tagThrow() {
    return {
        get [Symbol.toStringTag]() {
            return boom('TAGBOOM')
        },
    }
}
function ownKeysThrow() {
    return new Proxy({}, {
        ownKeys() {
            return boom('OWNKEYSBOOM')
        },
    })
}
function getTrapThrow() {
    return new Proxy({}, {
        get() {
            return boom('GETTRAPBOOM')
        },
    })
}
function getter(name, msg) {
    let o = {}
    Object.defineProperty(o, name, {
        get() {
            return boom(msg)
        },
        enumerable: true,
        configurable: true,
    })
    return o
}

//names13, 本套件於建構時讀取之選項名稱(全集)
const names13 = ['url', 'db', 'cl', 'fdModels', 'modelType', 'logging', 'logDetail', 'funLog', 'pk', 'autoGenPk', 'useStable', 'storage', 'useEncryption']

//unreadables, 不可讀之容器(每次產生新物件)
const unreadables = [
    { nm: '已撤銷之Proxy', mk: revoked },
    { nm: 'Symbol.toStringTag拋錯之物件', mk: tagThrow },
    { nm: 'ownKeys拋錯之Proxy', mk: ownKeysThrow },
]


if (isWindows()) {
    describe('WOrmMdb readable(R-READABLE)', function() {

        let wo = null
        let ss = null
        let w = null
        let evs = null

        async function ids() {
            return (await w.select()).map((v) => v.id).sort()
        }

        async function reset() {
            await w.delAll()
            await w.insert({ id: 'a', name: 'seed' })
            evs.error.length = 0
            evs.change.length = 0
        }

        before(async function() {
            wo = (await importSrc('WOrmMdb.mjs')).default
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            evs = { error: [], change: [] }
            w.on('error', (mode, data, msg) => {
                evs.error.push({ mode, data, msg })
            })
            w.on('change', (mode) => {
                evs.change.push(mode)
            })
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })


        describe('資料容器(data)不可讀: 寫入入口走原失敗通道並以固定詞彙拒絕(U1、U2)', function() {

            for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                for (let c of unreadables) {
                    it(`${api}: ${c.nm}整批reject固定詞彙、error事件恰一次且data為null、不發change、資料庫不變`, async function() {
                        await reset()
                        let rej = null
                        try {
                            await w[api](c.mk())
                        }
                        catch (err) {
                            rej = err
                        }
                        assert.strict.strictEqual(rej === null ? 'resolved' : rej.message, MSG_DATA)
                        assert.strict.strictEqual(evs.error.length, 1)
                        assert.strict.strictEqual(evs.error[0].mode, api)
                        assert.strict.strictEqual(evs.error[0].data, null, 'error事件之data為null, 不把不可讀之值交給訂閱函數')
                        assert.strict.strictEqual(evs.error[0].msg, MSG_DATA)
                        assert.strict.strictEqual(evs.change.length, 0)
                        assert.strict.deepStrictEqual(await ids(), ['a'])
                    })
                }
            }

            it('原訊息(拋錯之標籤、陷阱)不外洩於reject與error事件', async function() {
                await reset()
                for (let [mkv, secret] of [[tagThrow, 'TAGBOOM'], [ownKeysThrow, 'OWNKEYSBOOM']]) {
                    let rej = await w.insert(mkv()).catch((err) => err)
                    assert.strict.ok(rej.message.indexOf(secret) < 0)
                }
                assert.strict.ok(JSON.stringify(evs.error).indexOf('BOOM') < 0)
            })

            it('useStable為false之實例同樣(經snap, 不經佇列)', async function() {
                let w2 = wo(mkOpt(ss.fpStorage, { useStable: false }))
                let es = []
                w2.on('error', (mode, data, msg) => es.push([mode, data, msg]))
                await assert.rejects(() => w2.insert(revoked()), (err) => err.message === MSG_DATA)
                await assert.rejects(() => w2.del(ownKeysThrow()), (err) => err.message === MSG_DATA)
                assert.strict.deepStrictEqual(es, [['insert', null, MSG_DATA], ['del', null, MSG_DATA]])
            })

        })


        describe('資料容器可讀而型別不符照既有處理(U3), 不被誤判為不可讀', function() {

            for (let [lb, v] of [['5', 5], ['null', null], ['字串', 'abc'], ['布林', true]]) {
                it(`${lb}: insert與insertBulk resolve n為0, save與del回[], 不發error事件`, async function() {
                    await reset()
                    assert.strict.deepStrictEqual(await w.insert(v), { n: 0, nInserted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.insertBulk(v), { n: 0, nInserted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.save(v), [])
                    assert.strict.deepStrictEqual(await w.del(v), [])
                    assert.strict.strictEqual(evs.error.length, 0)
                    assert.strict.deepStrictEqual(await ids(), ['a'])
                })
            }

        })


        describe('複製階段之不可讀值(頂層或巢狀、不論原因)一律固定詞彙、與頂層不可讀同通道(U5, A3)', function() {

            //nested, 秘密字樣SECRET不得出現於reject與error事件之任何欄位
            let nullProtoDate = () => {
                let d = new Date(0)
                Object.setPrototypeOf(d, null)
                return d
            }
            let deepObj = (n) => {
                let o = {}
                for (let i = 0; i < n; i++) {
                    o = { c: o }
                }
                return o
            }
            let elemGetter = (i, v) => {
                let a = [{ id: 'z0', name: 'ok0' }, { id: 'z1', name: 'ok1' }, { id: 'z2', name: 'ok2' }]
                Object.defineProperty(a, i, { get: v, enumerable: true, configurable: true })
                return a
            }
            let u8aThrow = () => {
                return new Proxy(new Uint8Array(2), {
                    get() {
                        return boom('SECRET-U8A')
                    },
                })
            }
            let oneGetter = () => {
                let a = [null]
                Object.defineProperty(a, 0, { get: () => boom('SECRET-ELEM0'), enumerable: true, configurable: true })
                return a
            }
            let nested = [
                { nm: '陣列元素為已撤銷之Proxy', mk: () => [revoked()] },
                { nm: '陣列元素為Symbol.toStringTag拋錯者', mk: () => [tagThrow()] },
                { nm: '陣列元素為ownKeys拋錯者', mk: () => [ownKeysThrow()] },
                { nm: '陣列其後之元素(第2個)為已撤銷之Proxy', mk: () => [{ id: 'z0', name: 'ok0' }, revoked(), { id: 'z2', name: 'ok2' }] },
                { nm: '陣列其後之元素(第3個)為ownKeys拋錯者', mk: () => [{ id: 'z0', name: 'ok0' }, { id: 'z1', name: 'ok1' }, ownKeysThrow()] },
                { nm: '陣列其後之元素為拋錯之存取器', mk: () => elemGetter(1, () => boom('SECRET-ELEM')) },
                { nm: '長度1之陣列其[0]為拋錯之存取器', mk: () => oneGetter() },
                { nm: '列之id為存取器且拋錯', mk: () => Object.assign(getter('id', 'SECRET-GETBOOM'), { name: 'x' }) },
                { nm: '列之id為已撤銷之Proxy', mk: () => ({ id: revoked(), name: 'x' }) },
                { nm: '列之id為Symbol.toStringTag拋錯者', mk: () => ({ id: tagThrow(), name: 'x' }) },
                { nm: '列之欄位值為拋錯之存取器', mk: () => Object.assign(getter('name', 'SECRET-NAMEGETTER'), { id: 'z1' }) },
                { nm: '列之欄位值為已撤銷之Proxy', mk: () => ({ id: 'z1', name: revoked() }) },
                { nm: '列之欄位值為Symbol.toStringTag拋錯者', mk: () => ({ id: 'z1', name: tagThrow() }) },
                { nm: '列之欄位值為ownKeys拋錯者', mk: () => ({ id: 'z1', name: ownKeysThrow() }) },
                { nm: '列之欄位值為get陷阱拋錯之Uint8Array(u8a欄)', mk: () => ({ id: 'z1', name: u8aThrow() }) },
                { nm: '列之欄位值為原型為null之Date(可讀而無法複製)', mk: () => ({ id: 'z1', name: nullProtoDate() }) },
                { nm: '列之欄位值為50000層巢狀(可讀而無法複製)', mk: () => ({ id: 'z1', name: deepObj(50000) }) },
            ]

            for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                for (let c of nested) {
                    it(`${api}: ${c.nm}reject固定詞彙、error事件恰一次且data為null、不發change、資料庫不變`, async function() {
                        await reset()
                        let rej = await w[api](c.mk()).then(() => null, (err) => err)
                        assert.strict.ok(rej !== null, '須reject')
                        assert.strict.strictEqual(rej.message, MSG_DATA)
                        assert.strict.strictEqual(evs.error.length, 1, '與頂層不可讀同通道: error事件恰一次')
                        assert.strict.strictEqual(evs.error[0].mode, api)
                        assert.strict.strictEqual(evs.error[0].data, null)
                        assert.strict.strictEqual(evs.error[0].msg, MSG_DATA)
                        assert.strict.strictEqual(evs.change.length, 0)
                        assert.strict.ok(JSON.stringify(rej.message + evs.error[0].msg).indexOf('SECRET') < 0 && String(rej.message).indexOf('revoked') < 0, '不轉出拋出者之原訊息')
                        assert.strict.deepStrictEqual(await ids(), ['a'])
                    })
                }
            }

            it('insert: 不補值(巢狀id不可讀時不以自動產生之主鍵取代, 同批合格筆亦不寫入)', async function() {
                await reset()
                let rej = await w.insert([{ id: 'ok9', name: 'o' }, { id: revoked(), name: 'x' }]).then(() => null, (err) => err)
                assert.strict.strictEqual(rej.message, MSG_DATA)
                assert.strict.deepStrictEqual(await ids(), ['a'])
            })

            it('useStable為false之實例同樣(巢狀不可讀值經snap, 不經佇列)', async function() {
                let w2 = wo(mkOpt(ss.fpStorage, { useStable: false }))
                let es = []
                w2.on('error', (mode, data, msg) => es.push([mode, data, msg]))
                await assert.rejects(() => w2.insert({ id: revoked(), name: 'x' }), (err) => err.message === MSG_DATA)
                await assert.rejects(() => w2.save([{ id: 'z1', name: 'ok' }, revoked()]), (err) => err.message === MSG_DATA)
                assert.strict.deepStrictEqual(es, [['insert', null, MSG_DATA], ['save', null, MSG_DATA]])
            })

            //不擴大(align-rules A3 之範圍): 複製之後才讀取之原型上之存取器所拋者屬外來錯誤之診斷出口, 維持原樣(不轉固定詞彙; 逐筆之data為攤平後之複本, 非null)
            it('複製之後才讀取之原型上之存取器(類別實例之model欄getter拋錯): 屬外來錯誤之診斷出口, 不擴大, 維持原訊息與既有通道', async function() {
                class ProtoGetter {
                    constructor() {
                        this.id = 'zq'
                    }

                    get name() {
                        return boom('PROTOBOOM')
                    }
                }
                await reset()
                let rej = await w.insert(new ProtoGetter()).then(() => null, (err) => err)
                assert.strict.ok(rej !== null, '須reject')
                assert.strict.strictEqual(rej.message, 'PROTOBOOM')
                assert.strict.notStrictEqual(rej.message, MSG_DATA)
                assert.strict.strictEqual(evs.error.length, 1)
                assert.strict.notStrictEqual(evs.error[0].data, null)
                assert.strict.deepStrictEqual(await ids(), ['a'])
            })

        })


        describe('複製成功而判斷函數判為無效之data: 不可讀者固定詞彙拒絕、可讀而型別不符者照既有、有效輸入不探(U8, P4)', function() {

            //withProto, 以defineProperty建立自有屬性(不經原型鏈之set陷阱)
            let withProto = (proto, own) => {
                let o = Object.create(proto)
                for (let [k, v] of Object.entries(own)) {
                    Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
                }
                return o
            }
            let getProtoOfThrow = () => new Proxy({}, {
                getPrototypeOf() {
                    return boom('SECRET-GETPROTO')
                },
            })

            //lenThrowArray, 陣列子類別: 以長度引數建構(cloneDeep建立複本時)回傳length讀取拋錯之Proxy, 原值(無引數建構)為一般陣列;
            //cloneDeep成功而複本之length讀取拋錯, isearr回false(判斷函數不拋錯), 探針之elements: 'first'(同isearr之讀取)判為不可讀
            class LenThrowArray extends Array {
                constructor(...a) {
                    super(...a)
                    if (a.length > 0) {
                        return new Proxy(this, {
                            get(t, k, r) {
                                if (k === 'length') {
                                    return boom('SECRET-LEN')
                                }
                                return Reflect.get(t, k, r)
                            },
                        })
                    }
                }
            }
            let lenThrowArray = () => {
                let a = new LenThrowArray()
                a.push({ id: 'p6', name: 'x' })
                return a
            }

            //cloneDeep不讀原型鏈而成功(複本同原型), iseobj之for...in讀原型鏈而拋錯回false, 修前被當成[無資料]而靜默回空結果
            let unreadableProto = [
                { nm: '複本之length讀取拋錯之陣列(陣列子類別, 探針之elements first)', mk: lenThrowArray },
                { nm: '原型為ownKeys拋錯之Proxy且有自有屬性', mk: () => withProto(ownKeysThrow(), { id: 'p1', name: 'x' }) },
                { nm: '原型為ownKeys拋錯之Proxy且無自有屬性', mk: () => Object.create(ownKeysThrow()) },
                { nm: '原型為getPrototypeOf拋錯之Proxy且有自有屬性', mk: () => withProto(getProtoOfThrow(), { id: 'p2', name: 'x' }) },
                { nm: '原型為getPrototypeOf拋錯之Proxy且無自有屬性', mk: () => Object.create(getProtoOfThrow()) },
                { nm: '第二層原型為ownKeys拋錯之Proxy', mk: () => withProto(Object.create(ownKeysThrow()), { id: 'p3', name: 'x' }) },
            ]

            for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                for (let c of unreadableProto) {
                    it(`${api}: ${c.nm}reject固定詞彙、error事件恰一次且data為null、不發change、資料庫不變`, async function() {
                        await reset()
                        let rej = await w[api](c.mk()).then(() => null, (err) => err)
                        assert.strict.ok(rej !== null, '須reject(修前靜默resolve空結果)')
                        assert.strict.strictEqual(rej.message, MSG_DATA)
                        assert.strict.strictEqual(evs.error.length, 1)
                        assert.strict.strictEqual(evs.error[0].mode, api)
                        assert.strict.strictEqual(evs.error[0].data, null)
                        assert.strict.strictEqual(evs.error[0].msg, MSG_DATA)
                        assert.strict.strictEqual(evs.change.length, 0)
                        assert.strict.ok(JSON.stringify(rej.message + evs.error[0].msg).indexOf('SECRET') < 0, '不轉出拋出者之原訊息')
                        assert.strict.deepStrictEqual(await ids(), ['a'])
                    })
                }
            }

            it('useStable為false之實例同樣(經snap, 不經佇列)', async function() {
                let w2 = wo(mkOpt(ss.fpStorage, { useStable: false }))
                let es = []
                w2.on('error', (mode, data, msg) => es.push([mode, data, msg]))
                await assert.rejects(() => w2.insert(withProto(ownKeysThrow(), { id: 'p1', name: 'x' })), (err) => err.message === MSG_DATA)
                await assert.rejects(() => w2.del(Object.create(getProtoOfThrow())), (err) => err.message === MSG_DATA)
                assert.strict.deepStrictEqual(es, [['insert', null, MSG_DATA], ['del', null, MSG_DATA]])
            })

            //可讀而型別不符(判斷函數判為無效而探針判為可讀): 照既有(回空結果, 不發error事件); 其中原型有效之空物件、Map、Date、型別陣列之標籤非[object Object]者不加ownKeys探針
            let readableInvalid = [
                { nm: '空物件{}', mk: () => ({}) },
                { nm: '空陣列[]', mk: () => [] },
                { nm: '原型有效而無自有屬性之物件', mk: () => Object.create({ inherited: 1 }) },
                { nm: 'Map', mk: () => new Map([['id', 'm1']]) },
                { nm: 'Date', mk: () => new Date(0) },
                { nm: 'Uint8Array(10萬個元素)', mk: () => new Uint8Array(100000) },
                { nm: '原型為null而無自有屬性之物件', mk: () => Object.create(null) },
            ]
            for (let c of readableInvalid) {
                it(`${c.nm}: 可讀而型別不符, insert與insertBulk resolve n為0、save與del回[]、不發error事件(照既有)`, async function() {
                    await reset()
                    assert.strict.deepStrictEqual(await w.insert(c.mk()), { n: 0, nInserted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.insertBulk(c.mk()), { n: 0, nInserted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.save(c.mk()), [])
                    assert.strict.deepStrictEqual(await w.del(c.mk()), [])
                    assert.strict.strictEqual(evs.error.length, 0)
                    assert.strict.strictEqual(evs.change.length, 0)
                    assert.strict.deepStrictEqual(await ids(), ['a'])
                })
            }

            //有效輸入不探: 原型為Proxy而其陷阱僅在呼叫堆疊含chkReadable(探針)時拋錯, 其餘(iseobj之for...in、攤平)透明
            //有效之data(iseobj為true)不得經探針(探針只在判無效之分支內): 若探針移到判斷之前或無條件執行, 陷阱於探針之呼叫下拋錯而本案轉紅
            let probeOnlyProxy = () => {
                let fromProbe = () => /chkReadable/.test(new Error().stack)
                return new Proxy({}, {
                    ownKeys(t) {
                        if (fromProbe()) {
                            boom('SECRET-PROBE-ownKeys')
                        }
                        return Reflect.ownKeys(t)
                    },
                    getOwnPropertyDescriptor(t, k) {
                        if (fromProbe()) {
                            boom('SECRET-PROBE-gopd')
                        }
                        return Reflect.getOwnPropertyDescriptor(t, k)
                    },
                    getPrototypeOf(t) {
                        if (fromProbe()) {
                            boom('SECRET-PROBE-getproto')
                        }
                        return Reflect.getPrototypeOf(t)
                    },
                })
            }

            it('對照(探針確實會觸發陷阱): 原型為僅探針下拋錯之Proxy且無自有屬性(iseobj判無效而進探針)reject固定詞彙', async function() {
                await reset()
                let rej = await w.insert(Object.create(probeOnlyProxy())).then(() => null, (err) => err)
                assert.strict.ok(rej !== null && rej.message === MSG_DATA, rej === null ? 'resolved' : rej.message)
                assert.strict.strictEqual(evs.error.length, 1)
            })

            for (let api of ['insert', 'insertBulk', 'save']) {
                it(`${api}: 有效之data(原型為僅探針下拋錯之Proxy, 自有屬性有效)不經探針, 照常寫入(有效輸入不多讀)`, async function() {
                    await reset()
                    let id = 'pv-' + api
                    let r = await w[api](withProto(probeOnlyProxy(), { id, name: 'v' }))
                    assert.strict.ok(r !== null)
                    assert.strict.strictEqual(evs.error.length, 0)
                    assert.strict.deepStrictEqual(await ids(), ['a', id])
                })
            }

            it('有效之data陣列(各列原型為僅探針下拋錯之Proxy)不經探針, 照常寫入', async function() {
                await reset()
                await w.insert([withProto(probeOnlyProxy(), { id: 'pv1', name: 'v' }), withProto(probeOnlyProxy(), { id: 'pv2', name: 'v' })])
                assert.strict.strictEqual(evs.error.length, 0)
                assert.strict.deepStrictEqual(await ids(), ['a', 'pv1', 'pv2'])
            })

        })


        describe('option不可讀或其成員之getter拋錯: 入口階段error事件恰一次後reject(U1、U2、U4)', function() {

            let dataOf = {
                insert: () => [{ id: 'ok1', name: 'o' }],
                insertBulk: () => [{ id: 'ok1', name: 'o' }],
                save: () => [{ id: 'ok1', name: 'o' }],
                del: () => [{ id: 'a' }],
                select: () => ({}),
                delAll: () => ({ name: 'zzz' }),
                selectByPk: () => 'a',
            }
            let call = (api, option) => {
                return w[api](dataOf[api](), option)
            }

            for (let api of Object.keys(dataOf)) {

                it(`${api}: option為已撤銷之Proxy或get陷阱拋錯者reject固定詞彙invalid option(error事件恰一次、data為null、資料庫不變)`, async function() {
                    for (let mkv of [revoked, getTrapThrow]) {
                        await reset()
                        let rej = await call(api, mkv()).then(() => null, (err) => err)
                        assert.strict.ok(rej !== null, '須reject')
                        assert.strict.strictEqual(rej.message, MSG_OPTION)
                        assert.strict.strictEqual(evs.error.length, 1)
                        assert.strict.strictEqual(evs.error[0].mode, api)
                        assert.strict.strictEqual(evs.error[0].data, null)
                        assert.strict.strictEqual(evs.error[0].msg, MSG_OPTION)
                        assert.strict.strictEqual(evs.change.length, 0)
                        assert.strict.deepStrictEqual(await ids(), ['a'])
                    }
                })

                it(`${api}: option.instance為拋錯之存取器: 轉固定詞彙invalid option.instance(不轉出原文字), 同走入口階段(error事件恰一次、data為null、資料庫不變; A2)`, async function() {
                    await reset()
                    let rej = await call(api, getter('instance', 'SECRET-OPTGETBOOM')).then(() => null, (err) => err)
                    assert.strict.ok(rej !== null, '須reject')
                    assert.strict.strictEqual(rej.message, MSG_OPTION_INSTANCE)
                    assert.strict.strictEqual(evs.error.length, 1)
                    assert.strict.strictEqual(evs.error[0].mode, api)
                    assert.strict.strictEqual(evs.error[0].data, null)
                    assert.strict.strictEqual(evs.error[0].msg, MSG_OPTION_INSTANCE)
                    assert.strict.strictEqual(evs.change.length, 0)
                    assert.strict.deepStrictEqual(await ids(), ['a'])
                })

                it(`${api}: option為僅對字串鍵拋錯之get陷阱(容器可讀而成員拋錯): 轉固定詞彙invalid option.<首個被讀之成員名>(error事件恰一次、data為null、資料庫不變; A2)`, async function() {
                    await reset()
                    let option = new Proxy({}, {
                        get(t, k) {
                            if (typeof k === 'string') {
                                return boom('SECRET-GETTRAPSTR')
                            }
                            return undefined
                        },
                    })
                    let rej = await call(api, option).then(() => null, (err) => err)
                    assert.strict.ok(rej !== null, '須reject')
                    let first = api === 'insert' ? 'returnList' : 'instance'
                    assert.strict.strictEqual(rej.message, `invalid option.${first}: must be a readable value`)
                    assert.strict.strictEqual(evs.error.length, 1)
                    assert.strict.strictEqual(evs.error[0].data, null)
                    assert.strict.strictEqual(JSON.stringify(evs.error).indexOf('SECRET'), -1)
                    assert.strict.strictEqual(evs.change.length, 0)
                    assert.strict.deepStrictEqual(await ids(), ['a'])
                })

                it(`${api}: option可讀而型別不符(5、Symbol.toStringTag拋錯者、ownKeys拋錯者)照既有處理(不讀其標籤與鍵), 不被誤判為不可讀`, async function() {
                    for (let mkv of [() => 5, tagThrow, ownKeysThrow]) {
                        await reset()
                        let r = await call(api, mkv()).then(() => 'resolve', (err) => err.message)
                        assert.strict.strictEqual(r, 'resolve')
                        assert.strict.strictEqual(evs.error.length, 0)
                    }
                })

            }

            //U1: 探針置於判斷已失敗之後, 有效輸入不多讀: 以get陷阱記錄option被讀取之鍵, 有效option只被讀所需之成員(不讀Symbol.toStringTag等)
            it('有效option只讀所需之成員(探針不在有效路徑上多讀)', async function() {
                let want = {
                    insert: ['returnList', 'instance'],
                    insertBulk: ['instance'],
                    save: ['instance', 'autoInsert'],
                    del: ['instance'],
                    select: ['instance'],
                    delAll: ['instance'],
                    selectByPk: ['instance'],
                }
                for (let api of Object.keys(dataOf)) {
                    await reset()
                    let keys = []
                    let option = new Proxy({}, {
                        get(t, k) {
                            keys.push(k)
                            return undefined
                        },
                    })
                    await call(api, option)
                    assert.strict.deepStrictEqual(keys, want[api], api)
                }
            })

            it('insert: option.returnList為拋錯之存取器: 轉固定詞彙invalid option.returnList、error事件恰一次且data為null、不寫入(A2)', async function() {
                await reset()
                let rej = await w.insert({ id: 'ok1', name: 'o' }, getter('returnList', 'SECRET-OPTGETBOOM')).then(() => null, (err) => err)
                assert.strict.strictEqual(rej.message, 'invalid option.returnList: must be a readable value')
                assert.strict.strictEqual(evs.error.length, 1)
                assert.strict.strictEqual(evs.error[0].data, null)
                assert.strict.strictEqual(evs.error[0].msg, 'invalid option.returnList: must be a readable value')
                assert.strict.deepStrictEqual(await ids(), ['a'])
            })

            it('save: option.autoInsert為拋錯之存取器: 轉固定詞彙invalid option.autoInsert、error事件恰一次且data為null、不寫入(A2)', async function() {
                await reset()
                let rej = await w.save({ id: 'ok1', name: 'o' }, getter('autoInsert', 'SECRET-OPTGETBOOM')).then(() => null, (err) => err)
                assert.strict.strictEqual(rej.message, 'invalid option.autoInsert: must be a readable value')
                assert.strict.strictEqual(evs.error.length, 1)
                assert.strict.strictEqual(evs.error[0].data, null)
                assert.strict.strictEqual(evs.error[0].msg, 'invalid option.autoInsert: must be a readable value')
                assert.strict.deepStrictEqual(await ids(), ['a'])
            })

            it('各入口不讀之option成員為拋錯之存取器: 不影響該入口(insertBulk與returnList、del與autoInsert等), 不被誤判', async function() {
                await reset()
                assert.strict.deepStrictEqual(await w.insertBulk([{ id: 'ok1', name: 'o' }], getter('returnList', 'SECRET')), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await w.del([{ id: 'nonexist' }], getter('autoInsert', 'SECRET')), [{ n: 0, nDeleted: 0, ok: 1 }])
                assert.strict.strictEqual(evs.error.length, 0)
            })

        })


        describe('selectByPk之pk不可讀: reject固定詞彙; 可讀而非字串者回null(U1、U2、U3)', function() {

            for (let c of unreadables.filter((v) => v.nm !== 'ownKeys拋錯之Proxy').concat([{ nm: 'get陷阱(所有鍵)拋錯之Proxy', mk: getTrapThrow }])) {
                it(`${c.nm}: reject invalid pk、error事件恰一次且data為null(A5)`, async function() {
                    await reset()
                    let rej = await w.selectByPk(c.mk()).then(() => null, (err) => err)
                    assert.strict.ok(rej !== null, '須reject, 不被當成無效主鍵而回null')
                    assert.strict.strictEqual(rej.message, MSG_PK)
                    assert.strict.strictEqual(evs.error.length, 1)
                    assert.strict.strictEqual(evs.error[0].mode, 'selectByPk')
                    assert.strict.strictEqual(evs.error[0].data, null)
                    assert.strict.strictEqual(evs.error[0].msg, MSG_PK)
                })
            }

            it('ownKeys拋錯之Proxy: pk判斷不讀其鍵, 視為可讀而非字串, 回null', async function() {
                await reset()
                assert.strict.strictEqual(await w.selectByPk(ownKeysThrow()), null)
                assert.strict.strictEqual(evs.error.length, 0)
            })

            it('pk與option皆不可讀: 先報pk(讀取次序: pk先於option); pk有效而option不可讀: reject invalid option(A5、A1)', async function() {
                await reset()
                let rej = await w.selectByPk(revoked(), revoked()).then(() => null, (err) => err)
                assert.strict.strictEqual(rej.message, MSG_PK)
                assert.strict.strictEqual(evs.error.length, 1)
                assert.strict.strictEqual(evs.error[0].data, null)
                await reset()
                rej = await w.selectByPk('a', revoked()).then(() => null, (err) => err)
                assert.strict.strictEqual(rej.message, MSG_OPTION)
                assert.strict.strictEqual(evs.error.length, 1)
                assert.strict.strictEqual(evs.error[0].data, null)
            })

            it('pk為String包裝物件或拋錯之存取器物件(可讀而非字串): 回null, 不發error事件(不拆包)', async function() {
                await reset()
                assert.strict.strictEqual(await w.selectByPk(new String('a')), null) // eslint-disable-line no-new-wrappers
                assert.strict.strictEqual(await w.selectByPk(getter('x', 'SECRET-PKGETTER')), null)
                assert.strict.strictEqual(evs.error.length, 0)
            })

            for (let [lb, mkv] of [['5', () => 5], ['true', () => true], ['{}', () => ({})], ['[]', () => []], ['Symbol', () => Symbol('s')], ['BigInt', () => 10n], ['undefined', () => undefined], ['null', () => null], ['空字串', () => '']]) {
                it(`${lb}: 可讀而非有效主鍵者回null, 不發error事件`, async function() {
                    await reset()
                    assert.strict.strictEqual(await w.selectByPk(mkv()), null)
                    assert.strict.strictEqual(evs.error.length, 0)
                })
            }

            it('有效pk之命中不受影響', async function() {
                await reset()
                assert.strict.strictEqual((await w.selectByPk('a')).name, 'seed')
            })

        })


        describe('find不可讀由cvOrmFind處置: invalid find, error事件恰一次(U6, 核實不改)', function() {

            for (let api of ['select', 'delAll']) {
                for (let c of unreadables) {
                    it(`${api}: ${c.nm}reject invalid find, 資料庫不變`, async function() {
                        await reset()
                        let rej = await w[api](c.mk()).then(() => null, (err) => err)
                        assert.strict.ok(rej !== null && /^invalid find: /.test(rej.message), rej && rej.message)
                        assert.strict.strictEqual(evs.error.length, 1)
                        assert.strict.deepStrictEqual(await ids(), ['a'])
                    })
                }
            }

        })


        describe('建構opt(U1、U2、U3、U4)', function() {

            const mkO = (ext) => mkOpt(ss.fpStorage, ext)

            it('opt為已撤銷之Proxy、ownKeys拋錯之Proxy、get陷阱拋錯之Proxy: 同步throw invalid opt', function() {
                for (let mkv of [revoked, ownKeysThrow, getTrapThrow]) {
                    assert.strict.throws(() => wo(mkv()), (err) => err.message === 'invalid opt: must be a readable value')
                }
            })

            it('opt非物件維持既有TypeError(invalid opt: not an object)', function() {
                for (let v of [5, 'abc', null, undefined, true]) {
                    if (v === undefined) {
                        continue //預設引數
                    }
                    assert.strict.throws(() => wo(v), (err) => err instanceof TypeError && err.message === 'invalid opt: not an object')
                }
            })

            //A2: opt可讀(chkReadable不呼叫存取器)而其成員為拋錯之存取器或僅對字串鍵拋錯之get陷阱: 轉固定詞彙invalid opt.<成員名>, 不轉出存取器拋出之文字, 建構同步throw
            //例外: logDetail與funLog(由wsemi之getDiag處置, 診斷出口永不失敗, dspec C15)之存取器拋錯者視為未給, 建構成功(本套件於建構時讀取並複製全部選項[第66項], 此二鍵之讀取包try; 診斷輸出之觀察見unit-diaglog-wo)
            for (let k of names13) {
                if (k === 'logDetail' || k === 'funLog') {
                    it(`opt.${k}為拋錯之存取器: 建構成功(視為未給, 不throw、不轉出原文字; A2之例外, C15)`, function() {
                        assert.strict.doesNotThrow(() => wo(getter(k, 'SECRET-CTORGETBOOM')))
                    })
                    continue
                }
                it(`opt.${k}為拋錯之存取器: 同步throw invalid opt.${k}(不轉出原文字; A2)`, function() {
                    assert.strict.throws(() => wo(getter(k, 'SECRET-CTORGETBOOM')), (err) => err.message === `invalid opt.${k}: must be a readable value`)
                })
            }

            it('logDetail或funLog之存取器與其他選項之存取器同時拋錯: 報其他選項(此二鍵之視為未給不遮掉其他選項之A2)', function() {
                for (let k of names13.filter((v) => v !== 'logDetail' && v !== 'funLog')) {
                    let o = {}
                    Object.defineProperty(o, 'logDetail', { get: () => boom('SECRET-L'), enumerable: true, configurable: true })
                    Object.defineProperty(o, 'funLog', { get: () => boom('SECRET-F'), enumerable: true, configurable: true })
                    Object.defineProperty(o, k, { get: () => boom('SECRET-K'), enumerable: true, configurable: true })
                    assert.strict.throws(() => wo(o), (err) => err.message === `invalid opt.${k}: must be a readable value`, k)
                }
            })

            it('opt為僅對字串鍵拋錯之get陷阱: 同步throw invalid opt.<首個被讀之成員名>(url), 不轉出原文字(A2)', function() {
                let o = new Proxy({}, {
                    get(t, k) {
                        if (typeof k === 'string') {
                            return boom('SECRET-GETTRAPSTR')
                        }
                        return undefined
                    },
                })
                assert.strict.throws(() => wo(o), (err) => err.message === 'invalid opt.url: must be a readable value')
            })

            it('opt之自訂鍵(非本套件讀取之選項名稱)為拋錯之存取器: 同步throw invalid opt, 不回顯鍵名與原文字(A2)', function() {
                let o = mkO({})
                Object.defineProperty(o, 'SECRETKEY', {
                    get() {
                        return boom('SECRET-CUSTOM')
                    },
                    enumerable: true,
                    configurable: true,
                })
                assert.strict.throws(() => wo(o), (err) => err.message === MSG_OPT && err.message.indexOf('SECRET') < 0)
            })

            it('opt原型上之存取器為拋錯者: 與自有存取器同(A2)', function() {
                let o = Object.create(getter('cl', 'SECRET-PROTO'))
                assert.strict.throws(() => wo(o), (err) => err.message === 'invalid opt.cl: must be a readable value')
            })

            for (let k of ['url', 'db', 'cl', 'fdModels', 'modelType', 'pk', 'storage']) {
                for (let c of unreadables.filter((v) => v.nm !== 'ownKeys拋錯之Proxy')) {
                    it(`opt.${k}為${c.nm}: 同步throw invalid opt.${k}(不被當成型別不符而取預設值)`, function() {
                        assert.strict.throws(() => wo(mkO({ [k]: c.mk() })), (err) => err.message === `invalid opt.${k}: must be a readable value`)
                    })
                }
            }

            for (let k of ['autoGenPk', 'useStable', 'useEncryption']) {
                for (let c of unreadables.filter((v) => v.nm !== 'ownKeys拋錯之Proxy')) {
                    it(`opt.${k}為${c.nm}: 同步throw invalid opt.${k}`, function() {
                        assert.strict.throws(() => wo(mkO({ [k]: c.mk() })), (err) => err.message === `invalid opt.${k}: must be a readable value`)
                    })
                }
            }

            it('opt成員可讀而型別不符(5、String包裝物件、空字串、ownKeys拋錯之Proxy)依K3取預設值, 不throw', function() {
                for (let k of ['url', 'db', 'cl', 'fdModels', 'modelType', 'pk', 'storage', 'autoGenPk', 'useStable', 'useEncryption']) {
                    for (let mkv of [() => 5, () => new String('x'), () => '', ownKeysThrow]) { // eslint-disable-line no-new-wrappers
                        assert.strict.doesNotThrow(() => wo({ [k]: mkv() }), `opt.${k}`)
                    }
                }
            })

            it('有效opt只讀所需之13個成員名稱(探針不在有效路徑上多讀: 不讀Symbol.toStringTag等)', function() {
                let keys = []
                let o = new Proxy(mkO({}), {
                    get(t, k, r) {
                        keys.push(k)
                        return Reflect.get(t, k, r)
                    },
                })
                wo(o)
                assert.strict.deepStrictEqual(keys.filter((k) => typeof k !== 'string'), [], '不讀Symbol鍵(標籤)')
                assert.strict.strictEqual(new Set(keys).size, keys.length, '每個成員名稱只讀一次')
                assert.strict.deepStrictEqual(keys.sort(), ['autoGenPk', 'cl', 'db', 'fdModels', 'funLog', 'logDetail', 'logging', 'modelType', 'pk', 'storage', 'url', 'useEncryption', 'useStable'])
            })

            it('有效opt之成員只讀一次(探針不在有效路徑上多讀)', function() {
                let n = 0
                let o = mkO({})
                Object.defineProperty(o, 'cl', {
                    get() {
                        n++
                        return 'users'
                    },
                    enumerable: true,
                    configurable: true,
                })
                wo(o)
                assert.strict.strictEqual(n, 1)
            })

        })

    })
}
