# Dayloom离线八字排盘

1.1.8 的运行时引擎为精确锁定的 `lunar-typescript@1.8.6`。`index.ts` 调用该库完成历法、四柱、十神、藏干、纳音、十二长生、旬空、胎元、命宫、身宫和起运。`civil.ts` 是排盘与公农历日期选择器的共同入口。没有网络、大模型或设备权限请求。

- [6tail/lunar-typescript 源码](https://github.com/6tail/lunar-typescript)，作者 6tail，MIT；本地许可证 [LICENSE.lunar-typescript](LICENSE.lunar-typescript)，包内原许可证同时保留。
- `shensha.ts`、`tables.ts` 与典籍摘要继续采用原仓库 `bazi-skill` 的规则，作者 jinchenma94，MIT；许可证 [LICENSE](LICENSE)。`relations.ts` 与短释义为本项目整理。摘要不是古籍全文，不声称医学或预测效力。
- `legacy.ts`、`calendar.ts`、`astronomy.ts` 冻结保留原 Meeus 移植，供旧算法回归与开发对照；新排盘及新日期选择器不调用旧历法。旧命盘读取已保存的 JSON 与 Markdown，不重新计算。

## 输入和冻结结果

`calculateBazi(input: BaziInput, now: Date = new Date()): BaziChart`

- 历法 `solar` / `lunar`、日期 `YYYY-MM-DD`、农历闰月 `leapMonth`、排盘性别 `男` / `女`、选填出生地。
- 时间接受具体北京时间、十二时辰或未知。时辰仅为代表时刻，子时采用当日 00:00；未知时辰以当日 12:00 暂算年/月节气及起运，不生成时柱、命宫或身宫。
- 公历输入及农历年份限制1900—2100，换算后的公历也须在范围内；输入日期不能晚于注入 `now` 的北京时间日期。1900年初可显示农历1899年，不开放农历1899年输入。
- 新结果 `schemaVersion=2`，算法 `lunar-typescript-1.8.6-zhaoxi-2.0.0`，规则 `beijing-23h-yun2-relations2-shensha1`，释义 `bazi-notes-2`。各专业字段可选，以读取没有这些字段的旧结果。
- 昵称由档案界面在新命盘生成时保存为 `profileNickname` 并写入完整报告；旧命盘不补昵称。同一档案、规范化出生资料、算法和规则版本在独占事务中复用命盘；只改昵称保留原快照，改出生资料或算法/规则产生新版本。历史命盘与 AI 快照均不改写。

## 计算口径

北京时间 UTC+8；立春分年、十二节分月；日柱于23:00换日（EightChar sect=1）。不校正夏令时或真太阳时，出生地只作记录。

起运使用库的 `getYun(gender, 2)`：顺排取后一节、逆排取前一节；两端秒数分别忽略后求分钟差，每4320分钟折1年、360分钟折1月、12分钟折1天、余1分钟折2小时。交运日期按库依次加年、加月（超出月末时收敛）、加天、加小时。未知时辰/仅有时辰时显示暂算。出生至交运称“起运前”，不称“小运”。

当前阶段按北京时间精确交运区间 `[开始, 结束)` 判断；每步大运十年。流年列表覆盖该阶段实际经过的公历年，因此交运年可在相邻阶段各出现一次。干支标注指该年立春之后，年初立春前仍属上年；虚岁为公历年份减出生公历年加一，不等于周岁。流年只列至2100年，不提供流月。

关系只标记本命天干五合、地支六合/六冲/六害、二支相刑、重复自刑和完整三刑/三合/三会；半合不标成完整三合，不判断合化、旺衰、喜用神、评分或具体事件。

## 开发对照与已知差异

`tyme4ts@1.5.3` 只装在 ignored `artifacts/bazi-118/comparator`，不进入应用 package/lock、运行时 import 或正式包。两个库同属6tail，库间一致不等于独立权威认证。

```sh
./scripts/with-local-env.sh npm install --prefix artifacts/bazi-118/comparator --save-exact --ignore-scripts --no-audit --no-fund tyme4ts@1.5.3
./scripts/with-local-env.sh node --experimental-strip-types scripts/compare-bazi.mjs
```

2026-10-14实际执行212组（八个代表年份、年初/年中/年末、00:00/12:30/22:59/23:00、双性别及节气前后）。四柱、胎元/命宫/身宫、公农历、顺逆均0差异；1900/2000/2024/2100的立春与惊蛰共8个节气时刻同秒一致。完整结果在 `artifacts/bazi-118/comparison.json`，对照脚本位于 scripts/compare-bazi.mjs（私人验收产物不随开源副本分发）。

交运时间114组不同：91组 lunar 比 tyme 晚2小时；12组早24小时；6组早22小时；5组早70小时。两类原因已核对源码：tyme先用秒级实际间隔求绝对值再向下取整到分钟，lunar分别忽略两端秒数；tyme处理月末保留原出生日并向后溢出，lunar按顺序加年/月时收敛到有效月末。正式结果遵循已确认 lunar 口径，不能以 tyme 覆盖历史结果。代表样例：

| 北京时间 / 性别 | lunar 1.8.6 交运 | tyme 1.5.3 sect2 交运 |
|---|---|---|
| 2000-01-01 23:00 男 | 2008-05-08 01:00 | 2008-05-07 23:00 |
| 1900-12-31 12:30 男 | 1902-12-07 10:30 | 1902-12-08 10:30 |
| 2024-12-31 12:30 女 | 2033-03-06 14:30 | 2033-03-09 12:30 |

新旧引擎另有实际对照：原52份样例的共通四柱全部一致（0差异）；再固定2100-02-04的02:56—03:03八个分钟点，4组年/月柱不同。旧Meeus立春为02:56:18.847，新库为03:00:17，因此02:57—03:00旧盘已换年/月，新盘尚未换。两套都采用23点换日，日/时柱在该组不变。

新旧其他变化也明确分版：旧起运只给近似年/月并按旧年龄字符串展示，新版给分钟差换算后的年/月/天/小时和精确交运区间、虚岁；旧起运前误标“小运”，新版仅称起运前；旧日柱十神为“—”，新版标“日主”。新库增加专业字段与完整关系，旧schema原文不补写。原52样例的一致四柱不代表这些输出字段或边界时刻完全相同。完整新旧对照也保存在同一comparison.json的oldComparison中。

## 验证与导出

- `tests/bazi.test.ts` 的52份 Python 差分样例只验证冻结旧引擎，不作为新引擎正确性的证明。
- `tests/bazi-v2.test.ts` 固定公农历/闰月、1900/2100、立春/惊蛰分钟边界、23点、未知时辰、全部专业字段、起运/虚岁/阶段、完整三合三会/三刑、短释义和旧原文。
- `tests/bazi-snapshots.test.ts` 验证并发去重、规则/算法分版、编辑后的旧命盘与旧AI不变、新旧ZIP往返、历史分页及完整HTML/Markdown导出；不发送真实AI。
- 独立民用日期锚点：香港天文台 [2023](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/2023e.pdf) 的3月22日闰二月初一、[2024](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/2024e.pdf) 的2月10日正月初一、[2033](https://www.hko.gov.hk/en/gts/time/calendar/pdf/files/2033e.pdf) 的12月22日闰十一月初一。
- PDF/Markdown继续由概览导出已保存的完整报告，包含所有折叠内容与短释义，不按界面展开状态裁剪、不补算旧字段、不附AI会话。
- QA固定资料生成：`./scripts/with-local-env.sh node --experimental-strip-types scripts/make-bazi-qa-fixtures.ts`。输出仅供独立验收包恢复；3份合成出生资料、1份旧AI会话，没有个人资料、Key或其他业务记录。

未完成1900—2100全范围权威逐日逐时认证；历法锚点、库间对照、单测、构建和真机分别记录。当前手机、PDF落盘/渲染及多字号验收以 [项目说明](../../../README.md) 的当前验收边界为准。

## 真太阳时（规则 2.1）

`birthTime.ts` 保留两个时间轴。原始钟表只接受北京时间，DST 选择 summer 时减60分钟得到标准北京时间绝对瞬间；已校正选择 standard 不再扣减。真实瞬间负责立春年柱、十二节月柱、起运和大运。标准北京时间加 `4*(longitude-120)+equationOfTime` 分钟得到地点视太阳钟表，只用于日柱、时柱（23点换日）；命身宫以真实年月与校正时支组合。全部数字与说明冻结进新命盘、Markdown及AI预览，旧命盘和会话不回写。

均时差：Meeus《Astronomical Algorithms》太阳视黄经、视赤经与章28公式，使用实际儒略世纪和ΔT；保留低精度太阳坐标的局限，不宣称秒级权威。测试用独立NOAA儒略世纪偏心率/黄赤交角式对照1900—2100每5年每月，差小于0.1分钟；此对照证明实现一致性，不是权威历书绝对误差证书。参考 https://gml.noaa.gov/grad/solcalc/calcdetails.html 与 https://gml.noaa.gov/grad/solcalc/solareqns.PDF 。未采用一年谐波近似作为高精度依据。

DST来源：https://ftp.iana.org/tz/tzdb/asia `Rule PRC`。1986年5月4日、1987—1991年4月11日及以后的首个星期日02点跳到03点；各年9月11日及以后的首个星期日02点回到01点。涉及当天至结束日的具体钟表要求用户明确标准/夏令；回拨01点第一次为夏令、第二次为标准，春跳空时段不能选择summer。旧输入不含新口径字段仍按原有北京时间算，不自动重解释。

未知时间可保存待定真太阳时，保留无时柱路径，不伪造校正分钟。仅时辰不能选择真太阳时；需要具体时间，或保持北京时辰暂算。离线地点来源、许可证及覆盖局限见 LOCATIONS.md。新口径字段进入命盘去重，地点字段序不影响身份；备份验证兼容旧字段缺省。

合成导出资料：`./scripts/with-local-env.sh node --experimental-strip-types scripts/make-solar-time-fixtures.ts`，生成 `artifacts/solar-time` 下solar/dst/unknown.md与html和测试ZIP，不调用AI、不使用真人资料，不覆盖1.1.8验收材料。
