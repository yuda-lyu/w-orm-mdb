//unit-float-*之共用工具: 時區自證、牆上時間預言機(第87項: 非主鍵日期條件改用浮動時間)
//註: 預言機只以「牆上時間字串逐欄轉為UTC分量之數值」比較(Jet之語意: DATETIME為無時區牆上時間, 無夏令), 與主機時區及受測程式皆無關
//註: 時區切換一律經withTz(執行期賦值process.env.TZ, Windows上命令列TZ=僅UTC與POSIX名有效), 每個時區先經tzProof自證偏移, 避免名稱打錯而靜默落到UTC


//時區矩陣(10個): UTC+無夏令4個、負偏移2+2個、UTC+有夏令2個(柏林: 夏令跳過2026-03-29 02:00–03:00; Lord Howe: 2026-10-04 02:00–02:30跳過, 半小時制)
const TZS = ['Asia/Taipei', 'UTC', 'Asia/Kolkata', 'Pacific/Kiritimati', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Etc/GMT+12', 'Europe/Berlin', 'Australia/Lord_Howe']

//負偏移時區(Jet本地時間9999年末幾小時於其換算為UTC年10000)
const TZS_NEG = ['America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Etc/GMT+12']

const p2 = (n) => String(n).padStart(2, '0')
const p4 = (n) => String(n).padStart(4, '0')


/**
 * 以Intl(ICU)取指定時區於某瞬間之UTC偏移(分鐘, 東為正); 獨立於process.env.TZ與Date之本地getter
 */
function intlOffsetMin(tz, ms) {
    let f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    let o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
    let wall = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), Number(o.hour), Number(o.minute), Number(o.second))
    return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000)
}


/**
 * 時區自證(須於withTz(tz, …)之內呼叫): 本地getter之偏移 = ICU偏移(冬夏各一), 且負偏移時區之9999-12-31 23:59:59本地換算為UTC年10000
 * 註: 回傳說明字串供斷言訊息; 不符時拋錯
 */
function tzProof(tz) {
    let winter = Date.UTC(2026, 0, 15, 12, 0, 0)
    let summer = Date.UTC(2026, 6, 15, 12, 0, 0)
    for (let [lb, ms] of [['冬', winter], ['夏', summer]]) {
        let got = -new Date(ms).getTimezoneOffset()
        let exp = intlOffsetMin(tz, ms)
        if (got !== exp) {
            throw new Error(`tzProof ${tz} ${lb}: 本地getter偏移${got}分 != ICU偏移${exp}分(時區未生效)`)
        }
    }
    let neg = -new Date(winter).getTimezoneOffset() < 0
    let iso = mkLocal(9999, 12, 31, 23, 59, 59).toISOString()
    if (neg !== iso.startsWith('+010000-')) {
        throw new Error(`tzProof ${tz}: 負偏移=${neg} 但 9999-12-31 23:59:59 本地之ISO為${iso}`)
    }
    return `${tz} 冬${-new Date(winter).getTimezoneOffset()}分 夏${-new Date(summer).getTimezoneOffset()}分`
}


/**
 * 以本地分量建Date(setFullYear避免new Date(y,…)把0–99年映射為1900+)
 */
function mkLocal(y, mo = 1, d = 1, h = 0, mi = 0, s = 0, ms = 0) {
    let t = new Date(2000, 0, 1, 0, 0, 0, 0)
    t.setFullYear(y, mo - 1, d)
    t.setHours(h, mi, s, ms)
    return t
}


/**
 * 牆上時間字串(YYYY-MM-DD[T ]HH:mm:ss) -> 可比較之整數(以UTC分量, 與主機時區無關)
 */
function wallNum(s) {
    let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/)
    if (m === null) {
        throw new Error(`wallNum: bad wall ${s}`)
    }
    let t = new Date(0)
    t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    t.setUTCHours(Number(m[4]), Number(m[5]), Number(m[6]), 0)
    return t.getTime()
}


/**
 * Date之本地分量 -> 牆上時間字串(Date與epoch條件於Jet語意下所代表之牆上時間)
 */
function wallOfDate(d) {
    return `${p4(d.getFullYear())}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}


/**
 * 牆上時間字串 -> 條件值: str為無時區字串(T分隔, 如Jet回傳之格式), date為以本地分量建構之Date, epoch為其毫秒數
 */
function condVal(w, kind) {
    if (kind === 'str') {
        return w.replace(' ', 'T')
    }
    let m = w.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
    let d = mkLocal(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
    return kind === 'date' ? d : d.getTime()
}


/**
 * 條件值所代表之牆上時間: 字串即其自身; Date/epoch為其本地分量(夏令跳過之時刻建構時已被JS正規化, 以結果Date之本地分量為準)
 */
function condWall(w, kind) {
    if (kind === 'str') {
        return w
    }
    let v = condVal(w, kind)
    return wallOfDate(kind === 'date' ? v : new Date(v))
}


/**
 * 以Intl(ICU)取某瞬間於指定時區之牆上時間字串(YYYY-MM-DD HH:mm:ss); 獨立於process.env.TZ與Date之本地getter
 * 註: 供「固定瞬間」形式之條件(帶Z或偏移之字串、Date、epoch)建立預言機: 此類條件於Jet語意下之牆上時間 = 該瞬間於主機時區之本地分量
 */
function wallOfInstantIn(tz, ms) {
    let f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    let o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
    return `${p4(Number(o.year))}-${o.month}-${o.day} ${o.hour}:${o.minute}:${o.second}`
}


/**
 * 牆上時間字串(YYYY-MM-DD[T 或空白]HH:mm[:ss[.小數]]) -> 可比較之整數毫秒(小數秒取前三位, 截斷); 與主機時區無關
 * 註: 預言機側之文法獨立於受測碼: 省略秒視為0秒, 小數位數不限
 */
function wallMs(s) {
    let m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/)
    if (m === null) {
        throw new Error(`wallMs: bad wall ${s}`)
    }
    let t = new Date(0)
    t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    t.setUTCHours(Number(m[4]), Number(m[5]), m[6] === undefined ? 0 : Number(m[6]), m[7] === undefined ? 0 : Number(`${m[7]}00`.slice(0, 3)))
    return t.getTime()
}


/**
 * 預言機: 以牆上時間數值比較運算子
 */
function cmpOk(op, a, b) {
    return op === '$lt' ? a < b : op === '$lte' ? a <= b : op === '$gt' ? a > b : op === '$gte' ? a >= b : op === '$eq' ? a === b : a !== b
}


export { TZS, TZS_NEG, p2, p4, intlOffsetMin, tzProof, mkLocal, wallNum, wallOfDate, wallOfInstantIn, wallMs, condVal, condWall, cmpOk }
