import fs from 'fs'
import path from 'path'
import assert from 'assert'
import cvOrmFind from 'wsemi/src/cvOrmFind.mjs'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'
import { castPkFind, fillPkSlots } from '../src/pk.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { MAX_IN, WHY_ARRBIG, setupWl, readIds, mkW, call, runBoth, wlCases } from './unit-find-wl-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(系列條件白名單, dspec〈一之三〉; 本套件 cvOrmFind({ maxIn: 2000, maxList: 999 }))
//本檔: 案例表之外的專屬斷言(R-WL-04 之 3): 壞 find 不載入 model 與不開資料庫檔、$in/$nin 上限 2000、$or/$and 上限 999、
//castPkFind 輸出仍在白名單內、ids.mdb 覆寫鍵、檢查之值即使用之值、option.instance 與並行


const fill = (n, pre = 'k') => Array.from({ length: n }, (_, i) => `${pre}${i}`)

const BAD = () => ({ name: { $regex: 'a' } }) //白名單外之運算子


/**
 * 斷言select與delAll皆reject、訊息含原因、資料不變、error事件於reject前恰一次
 */
function assertBothRej(r, why, tag) {
    assert.strict.strictEqual(r.s.ok, false, `${tag} select應reject`)
    assert.strict.strictEqual(r.d.ok, false, `${tag} delAll應reject`)
    assert.strict.deepStrictEqual(r.deleted, [], `${tag} delAll reject時不得刪除任何列`)
    for (let [nm, x] of [['select', r.s], ['delAll', r.d]]) {
        assert.strict.ok(x.msg.startsWith('invalid find: '), `${tag} ${nm}訊息須以invalid find: 開頭, 實為[${x.msg.slice(0, 100)}]`)
        assert.strict.ok(x.msg.includes(why), `${tag} ${nm}訊息須含[${why}], 實為[${x.msg.slice(0, 100)}]`)
        assert.strict.deepStrictEqual(x.order, ['error', 'reject'], `${tag} ${nm}須於reject前恰發出一次error事件, 且不發change`)
    }
}


/**
 * 斷言select與delAll皆成功, 命中與刪除之集合相同且等於exp
 */
function assertBothOk(r, exp, tag) {
    assert.strict.strictEqual(r.s.ok, true, `${tag} select不應reject (${r.s.msg})`)
    assert.strict.strictEqual(r.d.ok, true, `${tag} delAll不應reject (${r.d.msg})`)
    assert.strict.deepStrictEqual(r.sIds, exp, `${tag} select命中`)
    assert.strict.deepStrictEqual(r.deleted, r.sIds, `${tag} delAll刪除之集合須等於select命中之集合`)
    assert.strict.deepStrictEqual(r.d.res, { n: exp.length, nDeleted: exp.length, ok: 1 }, `${tag} delAll回傳`)
}


if (isWindows()) {
    describe('WOrmMdb find whitelist專屬斷言(R-WL-04 之 3)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupWl('find-wlx')
        })

        after(function() {
            cleanStorage('./test/temp-find-wlx')
        })

        describe('案例表之契約事實(wsemi 增減即紅, 提醒回頭檢視本套件之接線)', function() {

            it('ids.mdb 覆寫鍵恰為 E25、N08; need.maxIn 之案恰為 H07、H28 且皆大於本套件上限', function() {
                //spec: wsemi/src/_cvOrmFindCases.mjs 檔頭註解〈ids 之 mdb 覆寫鍵僅 N08 與 E25〉; need.maxIn 者對 mdb(maxIn:2000)應 reject
                let ov = wlCases.cases.filter((c) => c.ids && c.ids.mdb !== undefined).map((c) => c.id).sort()
                assert.strict.deepStrictEqual(ov, ['E25', 'N08'])
                let nd = wlCases.cases.filter((c) => c.need).map((c) => c.id).sort()
                assert.strict.deepStrictEqual(nd, ['H07', 'H28'])
                for (let c of wlCases.cases.filter((c) => c.need)) {
                    assert.strict.ok(c.need.maxIn > MAX_IN, `${c.id}`)
                }
            })

            it('E25 與 N08 之 mdb 覆寫值與 sql 族不同且為 Jet 之語意(字串等值不分大小寫; 布林欄無 NULL)', async function() {
                //spec: 案例表 E25 {name:'peter'} → mdb ['a1','a2'](Jet 不分大小寫); N08 {flag:{$ne:true}} → mdb ['a2','a4','a5','a6'](NULL 存為 false)
                for (let id of ['E25', 'N08']) {
                    let c = wlCases.cases.find((v) => v.id === id)
                    assert.strict.notDeepStrictEqual([...c.ids.mdb].sort(), [...c.ids.sql].sort(), id)
                    let r = await runBoth(ctx, c.find)
                    assertBothOk(r, [...c.ids.mdb].sort(), id)
                }
            })

        })

        describe('壞 find 先於載入 model、開資料庫檔與送 SQL(R-WL-01)', function() {

            it('資料庫檔不存在: 壞 find 回 invalid find 且不建檔; 合法 find 則因開檔失敗而訊息不同', async function() {
                //spec: dspec〈一之三〉6.〈檢核先於讀取、連線與刪除〉; 壞 find 不開啟資料庫檔、不送 SQL
                let fp = `${ctx.fdTmp}/none-db.mdb`
                for (let fn of ['select', 'delAll']) {
                    let env = mkW(ctx, fp)
                    let bad = await call(env, (w) => w[fn](BAD()))
                    assert.strict.strictEqual(bad.ok, false, fn)
                    assert.strict.ok(bad.msg.startsWith('invalid find: unsupported operator'), `${fn} bad: ${bad.msg.slice(0, 100)}`)
                    assert.strict.deepStrictEqual(bad.order, ['error', 'reject'], fn)
                    assert.strict.strictEqual(fs.existsSync(fp), false, `${fn} 不得建立資料庫檔`)

                    //對照: 合法 find 會走到開檔, 訊息不是 invalid find(證明上列結果來自先於開檔之檢核)
                    let env2 = mkW(ctx, fp)
                    let good = await call(env2, (w) => w[fn]({ name: 'Peter' }))
                    assert.strict.strictEqual(good.ok, false, `${fn} good`)
                    assert.strict.ok(!good.msg.startsWith('invalid find: '), `${fn} good: ${good.msg.slice(0, 100)}`)
                    assert.strict.strictEqual(fs.existsSync(fp), false, `${fn} 合法 find 開檔失敗亦不得建檔`)
                }
            })

            it('model 不存在: 壞 find 回 invalid find; 合法 find 回 can not import model', async function() {
                //spec: 壞 find 不載入 model(檢核先於 initAdodb)
                for (let fn of ['select', 'delAll']) {
                    let bad = await call(mkW(ctx, ctx.fpSel, { cl: 'nomodel' }), (w) => w[fn](BAD()))
                    assert.strict.ok(bad.msg.startsWith('invalid find: unsupported operator'), `${fn} bad: ${bad.msg.slice(0, 100)}`)
                    assert.strict.deepStrictEqual(bad.order, ['error', 'reject'], fn)
                    let good = await call(mkW(ctx, ctx.fpSel, { cl: 'nomodel' }), (w) => w[fn]({ name: 'Peter' }))
                    assert.strict.ok(/can not import model/.test(good.msg), `${fn} good: ${good.msg.slice(0, 100)}`)
                }
            })

            it('上限類之壞 find($in/$nin 超過 2000、$and/$or 超過 999)亦先於開檔: 不存在之資料庫檔仍回 invalid find 且不建檔', async function() {
                //spec: dspec〈一之三〉6.〈檢核先於讀取、連線與刪除〉; 上限(maxIn 2000、maxList 999)由本套件呼叫強制, 不得留給其後 cvFind 內之檢核(那時已開檔讀表)
                let fp = `${ctx.fdTmp}/none-limit.mdb`
                let finds = [
                    ['$in 2001', () => ({ name: { $in: ['x', ...fill(2000)] } }), 'array is too large (> 2000)'],
                    ['$nin 2001(主鍵)', () => ({ id: { $nin: ['x', ...fill(2000)] } }), 'array is too large (> 2000)'],
                    ['$or 1000', () => ({ $or: fill(1000).map((v) => ({ name: v })) }), 'array is too large (> 999)'],
                    ['$and 1000', () => ({ $and: fill(1000).map((v) => ({ g: { $ne: v } })) }), 'array is too large (> 999)'],
                ]
                for (let fn of ['select', 'delAll']) {
                    for (let [nm, mk, why] of finds) {
                        let r = await call(mkW(ctx, fp), (w) => w[fn](mk()))
                        assert.strict.strictEqual(r.ok, false, `${fn} ${nm}`)
                        assert.strict.ok(r.msg.startsWith('invalid find: ') && r.msg.includes(why), `${fn} ${nm}: ${r.msg.slice(0, 100)}`)
                        assert.strict.deepStrictEqual(r.order, ['error', 'reject'], `${fn} ${nm}`)
                        assert.strict.strictEqual(fs.existsSync(fp), false, `${fn} ${nm} 不得建立資料庫檔`)
                    }
                }
            })

            it('option.instance: 壞 find reject 且 error 事件一次, 同一 instance 其後之合法 find 照常', async function() {
                //spec: 檢核對 instance 路徑同樣先於讀取; 壞 find 不破壞 instance
                let env = mkW(ctx, ctx.fpSel)
                let ins = await env.w.init()
                try {
                    for (let fn of ['select', 'delAll']) {
                        env.order.length = 0
                        let bad = await call(env, (w) => w[fn](BAD(), { instance: ins }))
                        assert.strict.strictEqual(bad.ok, false, fn)
                        assert.strict.ok(bad.msg.startsWith('invalid find: '), fn)
                        assert.strict.deepStrictEqual(bad.order, ['error', 'reject'], fn)
                    }
                    let rs = await env.w.select({ name: 'Peter' }, { instance: ins })
                    assert.strict.deepStrictEqual(rs.map((v) => v.id).sort(), ['a1', 'a2'])
                }
                finally {
                    await ins.close()
                }
                assert.strict.deepStrictEqual(await readIds(ctx.fpSel), ctx.seedIds)
            })

            it('useStable:false 並行: 壞 find 與合法 find 同時呼叫, 各自結果正確(壞 find 不關閉他次呼叫之 sequelize)', async function() {
                //spec: R-WL-01〈initAdodb 未被呼叫則不 closeSequelize〉
                let env = mkW(ctx, ctx.fpSel, { useStable: false })
                let rs = await Promise.allSettled([
                    env.w.select({ name: 'Peter' }),
                    env.w.select(BAD()),
                    env.w.select({ id: 'a3' }),
                    env.w.select(BAD()),
                ])
                assert.strict.strictEqual(rs[0].status, 'fulfilled')
                assert.strict.deepStrictEqual(rs[0].value.map((v) => v.id).sort(), ['a1', 'a2'])
                assert.strict.strictEqual(rs[1].status, 'rejected')
                assert.strict.strictEqual(rs[2].status, 'fulfilled')
                assert.strict.deepStrictEqual(rs[2].value.map((v) => v.id), ['a3'])
                assert.strict.strictEqual(rs[3].status, 'rejected')
                assert.strict.strictEqual(env.order.filter((v) => v === 'error').length, 2)
            })

        })

        describe('並行與刪除(外審 opus、sol 之漏格)', function() {

            it('useStable:false: 合法 delAll 與壞 find 之 select/delAll 同時呼叫, 僅合法者生效, 各壞 find 恰一次 error', async function() {
                //spec: R-WL-01; 壞 find 不得影響同時進行之合法呼叫
                ctx.nDel++
                let fp = `${ctx.fdTmp}/conc-${ctx.nDel}.mdb`
                fs.copyFileSync(ctx.fpSeed, fp)
                let env = mkW(ctx, fp, { useStable: false })
                let rs = await Promise.allSettled([
                    env.w.delAll({ id: 'a3' }),
                    env.w.select(BAD()),
                    env.w.delAll(BAD()),
                    env.w.select({ id: 'a1' }),
                ])
                assert.strict.deepStrictEqual(rs.map((v) => v.status), ['fulfilled', 'rejected', 'rejected', 'fulfilled'])
                assert.strict.deepStrictEqual(rs[0].value, { n: 1, nDeleted: 1, ok: 1 })
                assert.strict.deepStrictEqual(rs[3].value.map((v) => v.id), ['a1'])
                assert.strict.strictEqual(env.count('error'), 2)
                assert.strict.strictEqual(env.count('change'), 1)
                assert.strict.deepStrictEqual(await readIds(fp), ctx.seedIds.filter((v) => v !== 'a3'), '只刪 a3')
                fs.rmSync(fp, { force: true })
            })

        })

        describe('$in/$nin 上限 2000(maxIn)', function() {

            //spec: dspec〈一之三〉6.〈w-orm-mdb 之 $in 上限 2000〉; 主鍵 $in 每元素需 Jet 逐筆判定
            for (let [nm, mk, exp] of [
                ['非主鍵欄 $in', (n) => ({ name: { $in: ['Mary', ...fill(n - 1)] } }), ['a3']],
                ['非主鍵欄 $nin', (n) => ({ name: { $nin: [...fill(n)] } }), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
                ['主鍵 $in', (n) => ({ id: { $in: ['a3', ...fill(n - 1)] } }), ['a3']],
                ['主鍵 $nin', (n) => ({ id: { $nin: ['a3', ...fill(n - 1)] } }), ['a1', 'a2', 'a4', 'a5', 'a6']],
            ]) {
                it(`${nm}: 2000 元素可, 2001 元素 reject`, async function() {
                    let ok = await runBoth(ctx, () => mk(2000))
                    assertBothOk(ok, exp, `${nm} 2000`)
                    assert.strict.deepStrictEqual(ok.s.order, ['resolve'])
                    assert.strict.deepStrictEqual(ok.d.order, ['change', 'resolve'])
                    let ng = await runBoth(ctx, () => mk(2001))
                    assertBothRej(ng, WHY_ARRBIG, `${nm} 2001`)
                })
            }

        })

        describe('整個 find 內相異主鍵值總數上限 2000(外審opus F3)', function() {

            //spec: dspec〈一之三〉6.〈w-orm-mdb 之 $in 上限 2000〉的成本依據(主鍵值逐筆交 Jet 判定); 單一陣列上限(maxIn)擋不住分散於 $or/$and 內之多個陣列
            //總數檢查於讀表之後、送 Jet 逐筆判定之前, 訊息格式同其他入口檢核
            const pkIn = (pre, n) => ({ id: { $in: fill(n, pre) } })

            it('分散於 $or 內之多個主鍵 $in: 相異值總數 2001 reject(不送 Jet 逐筆判定), 2000 可', async function() {
                let t0 = Date.now()
                let ng = await runBoth(ctx, () => ({ $or: [pkIn('p', 1000), pkIn('q', 1001)] }))
                assertBothRej(ng, 'too many primary key values (> 2000)', '1000+1001')
                assert.strict.ok(Date.now() - t0 < 8000, `拒收須快速(未逐筆交 Jet), 實耗 ${Date.now() - t0}ms`)
                let ok = await runBoth(ctx, () => ({ $or: [{ id: { $in: ['a3', ...fill(999, 'p')] } }, pkIn('q', 1000)] }))
                assertBothOk(ok, ['a3'], '1000+1000')
            })

            it('跨 $in/$nin/$ne/$eq 與巢狀 $and 一併計數; 重複之值只計一次', async function() {
                let ng = await runBoth(ctx, () => ({ $and: [{ id: { $nin: fill(1200, 'p') } }, { $or: [{ id: { $in: fill(801, 'q') } }, { name: 'Mary' }] }] }))
                assertBothRej(ng, 'too many primary key values (> 2000)', 'nin1200+in801')
                //同一批值出現在三個陣列, 相異值只有 500 個
                let dup = await runBoth(ctx, () => ({ $or: [pkIn('d', 500), pkIn('d', 500), { id: { $nin: fill(500, 'd') } }] }))
                assertBothOk(dup, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], '重複值')
            })

        })

        describe('$or/$and 上限 999(maxList)', function() {

            //spec: dspec〈一之三〉6.〈w-orm-mdb 傳 maxList: 999〉; 999 項於 select 與 delAll 皆可, 1000 項 reject
            for (let [nm, mk, exp] of [
                ['$or 非主鍵欄', (n) => ({ $or: [{ id: 'a1' }, ...fill(n - 1).map((v) => ({ name: v }))] }), ['a1']],
                ['$or 主鍵(各元素經 castPkFind 包覆)', (n) => ({ $or: [{ id: 'a1' }, ...fill(n - 1).map((v) => ({ id: v }))] }), ['a1']],
                ['$and', (n) => ({ $and: fill(n).map((v) => ({ g: { $ne: v } })) }), ['a1', 'a2', 'a3', 'a4', 'a5']],
                ['$and 主鍵', (n) => ({ $and: [{ id: { $ne: 'a6' } }, ...fill(n - 1).map((v) => ({ id: { $ne: v } }))] }), ['a1', 'a2', 'a3', 'a4', 'a5']],
            ]) {
                it(`${nm}: 999 項可, 1000 項 reject`, async function() {
                    let ok = await runBoth(ctx, () => mk(999))
                    assertBothOk(ok, exp, `${nm} 999`)
                    let ng = await runBoth(ctx, () => mk(1000))
                    assertBothRej(ng, WHY_ARRBIG, `${nm} 1000`)
                })
            }

        })

        describe('主鍵條件經 castPkFind 後仍在白名單內(R-WL-03)', function() {

            //spec: dspec〈一之三〉6.〈檢核之值即使用之值〉與 reladb 1.1.10 報告 §7.2: 交入 cvFind 之樹不得含 Symbol 鍵(如 Op.and)或白名單外運算子
            let finds = [
                { id: 'a1' },
                { id: 'a1', name: 'Peter' },
                { id: { $eq: 'a1' } },
                { id: { $in: ['a1', 'a2'] } },
                { id: { $in: [] } },
                { id: { $ne: 'a1' } },
                { id: { $nin: ['a1', 'a2'] } },
                { id: { $gt: 'a1', $lte: 'a5' } },
                { id: { $eq: 'a1', $ne: 'a2', $in: ['a1'], $nin: ['a3'], $gte: 'a1', $lt: 'zz' } },
                { $or: [{ id: 'a1' }, { id: { $ne: 'a2' }, g: 'A' }, { name: 'Tom' }] },
                { $and: [{ id: { $in: ['a1', 'a2'] } }, { $or: [{ id: 'a1' }, { age: { $gt: 20 } }] }] },
                { id: 'a1', $or: [{ id: 'a1' }, { id: 'a2' }] },
                { $or: [{ id: { $ne: 'z'.repeat(256) } }, { name: 'Tom' }] }, //主鍵否定值全為不可能存在者(外審opus F1)
                { $and: [{ id: { $nin: ['z'.repeat(256)] } }] },
                { id: { $gt: 'z'.repeat(256) } },
            ]

            const walk = (o, acc = []) => {
                if (o !== null && typeof o === 'object') {
                    for (let k of Reflect.ownKeys(o)) {
                        acc.push(k)
                        walk(o[k], acc)
                    }
                }
                return acc
            }

            finds.forEach((f, i) => {
                it(`P${i + 1} ${JSON.stringify(f)}`, function() {
                    let fd = cvOrmFind(f, { maxIn: MAX_IN, maxList: 999 })
                    let { find, slots } = castPkFind(fd, 'id', 'str', '__worm_wi_test')
                    fillPkSlots(slots, () => [0, 2])
                    assert.strict.doesNotThrow(() => cvOrmFind(find, { maxList: 999 }), '命中序號非空')
                    //另以命中序號皆為空填入(全部填 -1)再檢核一輪(外審opus F7: 原僅填 [0,2])
                    let { find: find2, slots: slots2 } = castPkFind(fd, 'id', 'str', '__worm_wi_test')
                    fillPkSlots(slots2, () => [])
                    assert.strict.doesNotThrow(() => cvOrmFind(find2, { maxList: 999 }), '命中序號為空')
                    let ks = walk(find)
                    assert.strict.deepStrictEqual(ks.filter((k) => typeof k === 'symbol'), [], '不得含 Symbol 鍵')
                    let ops = ks.filter((k) => typeof k === 'string' && k[0] === '$')
                    for (let k of ops) {
                        assert.strict.ok(['$and', '$or', '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin'].includes(k), `白名單外運算子[${k}]`)
                    }
                    //spec: 輸出再經 cvOrmFind 檢核須不拋錯(reladb 的 cvFind 第一步即為此檢核)
                    assert.strict.doesNotThrow(() => cvOrmFind(find, { maxList: 999 }))
                })
            })

            it('序號條件併入同一物件(不增層、無 Symbol 鍵), 同運算子重複才另以字串鍵 $and 置放; 序號欄名符合欄名文法', function() {
                let wi = '__worm_wi_x1y2'
                let fd = cvOrmFind({ id: 'a1', name: 'Peter' }, { maxIn: MAX_IN, maxList: 999 })
                let { find } = castPkFind(fd, 'id', 'str', wi)
                assert.strict.deepStrictEqual(Reflect.ownKeys(find).sort(), ['name', wi].sort())
                assert.strict.ok(/^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(wi))
                let fd2 = cvOrmFind({ id: { $eq: 'a1', $in: ['a2'] } }, { maxIn: MAX_IN, maxList: 999 })
                let { find: f2 } = castPkFind(fd2, 'id', 'str', wi)
                assert.strict.deepStrictEqual(Reflect.ownKeys(f2), ['$and'])
            })

        })

        describe('檢查之值即使用之值(R-WL-00)', function() {

            //spec: dspec〈一之三〉6.〈每值只讀一次並以全新深複本供後續使用〉; 第二次讀取回不同值之 Proxy, select 與 delAll 皆只用第一次所讀
            const moving = (key, first, second) => {
                let n = 0
                return new Proxy({ [key]: first }, {
                    getOwnPropertyDescriptor(t, k) {
                        let d = Reflect.getOwnPropertyDescriptor(t, k)
                        if (k === key) {
                            n++
                            if (n > 1) {
                                d = { ...d, value: second }
                            }
                        }
                        return d
                    },
                    get(t, k, r) {
                        if (k === key) {
                            n++
                            return n > 1 ? second : first
                        }
                        return Reflect.get(t, k, r)
                    },
                })
            }

            it('主鍵欄: 讀值後即不再讀呼叫端的 find', async function() {
                let r = await runBoth(ctx, () => moving('id', 'a1', 'a2'))
                assertBothOk(r, ['a1'], '主鍵欄 Proxy')
            })

            it('非主鍵欄: 讀值後即不再讀呼叫端的 find', async function() {
                let r = await runBoth(ctx, () => moving('name', 'Mary', 'Tom'))
                assertBothOk(r, ['a3'], '非主鍵欄 Proxy')
            })

            it('delAll 之「無條件」判定讀複本: 呼叫端 find 之 ownKeys 於檢核之後回空, 不得因此走全刪', async function() {
                //spec: dspec〈一之三〉6.〈檢查之值即使用之值〉; R-WL-02: 只有複本無自有鍵才走 DELETE FROM 全刪
                //cvOrmFind 內讀到 {id:'a1'}, 其後(本套件程式)再讀 ownKeys 則為空: 若全刪判定改讀呼叫端之 find, 會刪光全表
                //校準: 先數出 cvOrmFind 自己讀 ownKeys 幾次(n0, 不依賴呼叫堆疊或檔名), 之後第 n0+1 次起回空
                let calib = 0
                cvOrmFind(new Proxy({ id: 'a1' }, {
                    ownKeys(t) {
                        calib++
                        return Reflect.ownKeys(t)
                    },
                }), { maxIn: MAX_IN, maxList: 999 })
                assert.strict.ok(calib >= 1, 'cvOrmFind 至少讀一次 ownKeys')
                const emptyAfterCheck = () => {
                    let n = 0
                    return new Proxy({ id: 'a1' }, {
                        ownKeys(t) {
                            n++
                            return n <= calib ? Reflect.ownKeys(t) : []
                        },
                    })
                }
                let r = await runBoth(ctx, emptyAfterCheck)
                assertBothOk(r, ['a1'], 'ownKeys 於檢核後回空之 Proxy')
            })

            it('主鍵欄 $ne: 讀值後即不再讀呼叫端的 find(否定語境第二次讀取不得使條件消失)', async function() {
                let r = await runBoth(ctx, () => ({ id: moving('$ne', 'a1', 'zz') }))
                assertBothOk(r, ['a2', 'a3', 'a4', 'a5', 'a6'], '主鍵欄 $ne Proxy')
            })

        })

        describe('主鍵條件改寫後仍可組合、不放大巢狀深度(外審sol F01、F02)', function() {

            //spec: dspec〈一之三〉6.〈邏輯巢狀深度 32〉〈空條件 reject〉; 原 find 在白名單內者, 經 castPkFind 改寫後不得變成白名單外(空子式)或超過深度上限
            const L256 = 'z'.repeat(256) //超過255字元之主鍵值: 不可能存在, $ne/$nin 必不相等(恆真)

            it('主鍵 $ne/$nin 僅含不可能存在之值: 於 $and/$or 內仍為恆真條件, 不得化簡成空子式而被拒收', async function() {
                //F01: { $and: [{ id: { $ne: L } }, { name: 'Mary' }] } 原本合法(恆真且 name 命中 a3), 曾因空子式 {} 被 reladb 之 cvFind 拒收
                for (let [nm, mk, exp] of [
                    ['$and 內 $ne', () => ({ $and: [{ id: { $ne: L256 } }, { name: 'Mary' }] }), ['a3']],
                    ['$or 內 $nin', () => ({ $or: [{ id: { $nin: [L256] } }, { id: 'a1' }] }), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
                    ['巢狀 $and/$or', () => ({ $and: [{ $or: [{ id: { $ne: L256 } }] }, { g: 'A' }] }), ['a1', 'a2']],
                    ['根層 $ne', () => ({ id: { $ne: L256 } }), ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']],
                    ['混入有效排除鍵', () => ({ $and: [{ id: { $nin: [L256, 'a1'] } }, { g: 'A' }] }), ['a2']],
                ]) {
                    let r = await runBoth(ctx, mk)
                    assertBothOk(r, exp, nm)
                }
            })

            it('每層同時帶主鍵與邏輯條件之巢狀: 原深度 16、32 可(改寫不增層), 33 reject', async function() {
                //F02: 原先每層改寫多包兩層, 原深度 16 即被放大成 33 而被拒收; 深度計法同案例表 H18(chain(n) 為 n 層 $and)
                const deep = (n) => {
                    let f = { id: 'a1' }
                    for (let i = 0; i < n; i++) {
                        f = { id: { $ne: 'a6' }, $and: [f] }
                    }
                    return f
                }
                for (let n of [1, 15, 16, 31, 32]) {
                    let r = await runBoth(ctx, () => deep(n))
                    assertBothOk(r, ['a1'], `每層含主鍵 ${n} 層`)
                }
                let ng = await runBoth(ctx, () => deep(33))
                assertBothRej(ng, 'nesting is too deep', '每層含主鍵 33 層')
            })

            it('深度 32 且最內層為主鍵條件(LW3 原邊界): 可; 33 層 reject', async function() {
                const chain = (n, inner) => {
                    let o = inner
                    for (let i = 0; i < n; i++) {
                        o = { $and: [o] }
                    }
                    return o
                }
                let ok = await runBoth(ctx, () => chain(32, { id: 'a1' }))
                assertBothOk(ok, ['a1'], '32 層主鍵在最內層')
                let ok2 = await runBoth(ctx, () => chain(32, { id: { $nin: ['a2', 'a3'] }, g: 'A' }))
                assertBothOk(ok2, ['a1'], '32 層 $nin 加非主鍵在最內層')
                let ng = await runBoth(ctx, () => chain(33, { id: 'a1' }))
                assertBothRej(ng, 'nesting is too deep', '33 層主鍵在最內層')
            })

        })

        describe('model 之主鍵屬性與資料表實體欄名不符(外審sol F03)', function() {

            //spec: R-FIND-01〈過濾表只納入 Jet 列實有之欄, model 有而 Jet 表無之屬性引用之條件由嚴格鍵 reject〉; 主鍵等值類條件亦同, 不得因取不到存值而漏查
            let fdc = null
            let fpc = null

            before(async function() {
                fdc = `${ctx.fdTmp}/casepk`
                fs.mkdirSync(`${fdc}/models`, { recursive: true })
                fs.writeFileSync(path.join(fdc, 'models', 'casepk.js'), `module.exports = function(sequelize, DataTypes) {
return sequelize.define('casepk', {
'id': { type: DataTypes.STRING, allowNull: false, primaryKey: true, autoIncrement: false, comment: null },
'name': { type: DataTypes.STRING, allowNull: true, autoIncrement: false, comment: null }
}, { tableName: 'casepk' });
};
`, 'utf8')
                fpc = path.resolve(`${fdc}/casepk.mdb`)
                let jet = jetOpen({ path: fpc, password: '' })
                await jet.create()
                await jet.execute('CREATE TABLE [casepk] ([ID] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255))')
                let r = await jet.run([
                    { type: 'execute', sql: 'INSERT INTO [casepk] ([ID], [name]) VALUES (\'a\', \'Alpha\')' },
                    { type: 'execute', sql: 'INSERT INTO [casepk] ([ID], [name]) VALUES (\'b\', \'Beta\')' },
                ])
                assert.strict.ok(r.ok, r.error)
            })

            it('model 為 id 而資料表為 ID: 主鍵等值、$in、$ne、範圍條件皆整批 reject(unknown column name), 不漏查、不使 select 與 delAll 不一致', async function() {
                const mk = () => wo({ url: 'mdb://:', db: 'worm', cl: 'casepk', pk: 'id', fdModels: `${fdc}/models`, storage: fpc })
                for (let find of [{ id: 'a' }, { id: { $in: ['a'] } }, { id: { $ne: 'a' } }, { id: { $nin: ['a'] } }, { id: { $gte: 'a' } }, { $or: [{ id: 'a' }, { name: 'Beta' }] }]) {
                    for (let fn of ['select', 'delAll']) {
                        let w = mk()
                        let evs = []
                        w.on('error', (e) => evs.push(e))
                        let msg = ''
                        try {
                            await w[fn](find)
                        }
                        catch (e) {
                            msg = String((e && e.message) || e)
                        }
                        assert.strict.ok(/unknown column name \[id\]/.test(msg), `${fn} ${JSON.stringify(find)}: [${msg.slice(0, 100)}]`)
                        assert.strict.strictEqual(evs.length, 1, `${fn} ${JSON.stringify(find)} error事件`)
                    }
                }
                let jet = jetOpen({ path: fpc, password: '' })
                let rows = await jet.query('SELECT [ID] FROM [casepk]')
                assert.strict.deepStrictEqual(rows.map((v) => v.ID).sort(), ['a', 'b'], '不得刪除任何列')
                //不涉及主鍵之條件照常
                let rs = await mk().select({ name: 'Alpha' })
                assert.strict.deepStrictEqual(rs.map((v) => v.ID), ['a'])
            })

        })

        describe('主鍵與無效值', function() {

            it('delAll({id: undefined}) 與 select({id: 123n}) reject 且資料不變(審計方案 §7.3 mdb 項 3)', async function() {
                //spec: 審計方案 §5.1 mdb: delAll({id:undefined})、select({id:123n}) 現況為「無命中」,改為 reject
                let r1 = await runBoth(ctx, () => ({ id: undefined }))
                assertBothRej(r1, 'undefined is not allowed', 'id:undefined')
                let r2 = await runBoth(ctx, () => ({ id: 123n }))
                assertBothRej(r2, 'unsupported value type', 'id:123n')
            })

        })

    })
}
