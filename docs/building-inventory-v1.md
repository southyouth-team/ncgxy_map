# 南昌工学院全校建筑资产清单 V1.0

## 清单定位

本清单来自学校官网、招生网和教务处公开页面，是**现场普查候选台账**，不是已经完成的建筑测绘清单。当前登记 17 条建筑/建筑群/场馆候选记录（B001–B017），以及 6 条环境资产记录（E001–E006），合计 23 条候选记录。分组条目需要现场拆分，重复名称需要核验，不得直接按条目数统计楼栋总数。

## 状态说明

- `official-mentioned`：官方页面出现该名称，实体位置与现状尚未现场核实。
- `group-needs-splitting`：官方只提供建筑群/实训楼群信息，需要逐栋拆分。
- `environment-asset`：道路、水体、桥梁、体育场等非普通楼栋资产。
- `confidence=unverified`：未完成现场核验；坐标、轮廓、尺寸、高度保持空值。

## 建筑候选清单

| 编号 | 名称 | 类型 | 当前状态 | 现场核验重点 |
|---|---|---|---|---|
| B001 | 致远楼 | building | official-mentioned | 待现场确认楼体位置、轮廓、层数及是否有扩建 |
| B002 | 笃行楼 | building | official-mentioned | 待现场确认位置、层数及现状名称 |
| B003 | 图书馆 | building | official-mentioned | 待确认当前建筑外轮廓、层数、附属体量 |
| B004 | 民族活动中心 | building | official-mentioned | 待确认是否同一建筑及建筑边界 |
| B005 | 电子信息楼 | building | official-mentioned | 待现场核实官方名称、位置与外形 |
| B006 | 校史馆 | building-or-internal-venue | official-mentioned | 待确认是否独立建筑或位于综合建筑内部 |
| B007 | 实训楼（待拆分） | building-group | group-needs-splitting | 现场逐栋编号，不能把所有实训场景合并为一栋 |
| B008 | 教学楼群（待拆分） | building-group | group-needs-splitting | 按实际独立楼体拆分编号 |
| B009 | 一号教学楼（南） | building | official-mentioned | 待现场核对名称、位置及是否仍使用该称谓 |
| B010 | 思齐楼 | building | official-mentioned | 网页列有平面图入口，需打开附件核对楼栋与图纸信息 |
| B011 | 至善楼 | building | official-mentioned | 网页列有平面图入口，需打开附件核对楼栋与图纸信息 |
| B012 | 明德楼 | building | official-mentioned | 网页列有平面图入口，需打开附件核对楼栋与图纸信息 |
| B013 | 明志楼 | building | official-mentioned | 网页列有平面图入口，需打开附件核对楼栋与图纸信息 |
| B014 | 食堂（名称待核实） | building-or-building-group | official-mentioned | 需确认对应第一食堂、第二食堂或其他食堂建筑 |
| B015 | 第一食堂（待核实） | building | official-mentioned | 需核对与“食堂”条目是否为同一实体，暂不重复计入建筑总数 |
| B016 | 宿舍楼群（待拆分） | building-group | group-needs-splitting | 现场按独立楼栋拆分，逐栋记录楼号与建筑轮廓 |
| B017 | 美术大师博物馆 | building-or-museum-venue | official-mentioned | 待确认是否独立建筑或位于其他建筑内部 |
| E001 | 赣江体育场 | sports-facility | environment-asset | 作为场地/看台等组合资产建模，核对是否包含独立建筑 |
| E002 | 景明桥 | bridge | environment-asset | 环境资产，不计入建筑楼栋数量 |
| E003 | 望月湖 | water-body | environment-asset | 环境资产，采集水岸线 |
| E004 | 古典雅致的东大门 | gate | environment-asset | 需现场核实当前校门是否与官网照片一致 |
| E005 | 大草坪 | landscape-area | environment-asset | 环境资产，采集边界 |
| E006 | 校园道路/街道 | road-network | environment-asset | 以道路网络矢量化，不作为建筑资产 |

## 官方资料来源

1. [招生网-美丽校园](https://zsb.ncpu.edu.cn/xiaoyuansh/meilixiaoyuan/)：致远楼、笃行楼、宿舍楼群、景明桥、望月湖、东大门、图书馆、食堂、民族活动中心、电子信息楼等。
2. [招生网-教学设施](https://zsb.ncpu.edu.cn/xiaoyuansh/jiaoxuesheshi/)：校史馆、实训楼、教学楼群、赣江体育场、一号教学楼（南）等。
3. [教务处-教室管理](https://jwc.ncpu.edu.cn/jiaowuguanli/jiaoshiguanli/)：公开页面列有思齐楼、至善楼、明德楼、明志楼、致远楼平面图入口。
4. [党政办公室](https://dbxb.ncpu.edu.cn/)：常用查询中列有校园地图入口。

## 现场普查规则

1. 到达现场后先核对建筑实体，再确认官方名称；名称不确定时保留临时编号。
2. 将“建筑群”拆成独立物理楼栋；每栋分配永久 buildingId，不因后续确认名称而更换编号。
3. 同一实体的别名/重复条目合并，保留 sourceRefs，不重复计数。
4. 现场采集 footprint、长宽、层数、屋顶、四向照片和坐标；未测字段留空。
5. 通过核验后再将记录从本清单迁入 `public/data/buildings.json`，进入 GLB 建模工作流。

## 重要限制

官网图集名称不等于建筑清册；图片数量不等于建筑数量。教务处平面图入口可能对应楼层平面或教学场所信息，需逐个打开附件确认，不能直接当作建筑立面图或总平面图。公开地图和官网图片的再利用须核查授权。
