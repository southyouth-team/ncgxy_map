# 南昌工学院校园建筑实地采集表 V1.0

## 1. 使用规则

- **一栋实际建筑一条记录**。宿舍楼群、教学楼群、实训楼群等必须拆分为独立楼栋后采集，不得把整个建筑群当成一栋楼。
- 资产台账中的 `B001` 等编号是候选资产编号。若一条记录对应多个实际楼栋，现场先使用临时子编号，例如 `B016-01`、`B016-02`；复核后再登记正式唯一编号，并同步更新 `public/data/building-inventory-v1.json`。
- 未测量的数据留空，不得估算后伪装成实测值。估算值必须在备注中注明估算依据。
- 坐标统一记录为 WGS84 十进制度（手机地图/GNSS 显示的坐标系需注明）；模型最终使用校园本地米制坐标，后续统一转换，不直接把经纬度填入 Three.js 的 XYZ。
- 建筑长宽应尽量依据 footprint 主轴记录；不规则建筑需在 `cornerPoints` 中记录各转角坐标或草图编号，必要时另附测绘文件。
- 手机 GNSS 适合初步定位，不等同于测绘级建筑角点。关键尺寸建议用激光测距仪或经复核的底图测量。
- 现场照片应确保能识别楼栋，避免只拍局部；拍摄四向立面、入口、屋顶可见部分和主要转角。无法拍摄的方向注明原因。
- 拍摄前确认场地管理要求；不要拍摄或记录无关个人隐私信息。

## 2. 字段说明

| 字段 | 填写要求 |
|---|---|
| buildingId | 资产台账编号；建筑群拆分时先用临时子编号 |
| officialName | 官网、楼牌或校方确认的正式名称；未确认填“待核实” |
| fieldName | 现场楼牌名称或便于识别的临时名称 |
| areaOrZone | 校园区域/片区名称；不确定可留空 |
| latitude / longitude | WGS84 十进制度；同时在 coordinateMethod 中注明设备和坐标来源 |
| coordinateMethod | 手机 GNSS、公开地图定位、测绘设备等 |
| cornerPoints | 建筑 footprint 转角坐标或对应草图/测绘文件编号 |
| footprintLengthM / footprintWidthM | 建筑主体外轮廓长、宽，单位米；不规则形状另附转角记录 |
| floorCount | 地上层数；地下层数可写入 notes |
| estimatedHeightM | 建筑高度（米）；必须在 heightMethod 注明实测、图纸、估算等 |
| heightMethod | 激光测距、图纸、楼层估算、现场目测等 |
| mainEntranceDirection | 主入口朝向，如北、东北；无法判断留空 |
| buildingOrientation | 建筑长轴方向或方位角，注明采用的表达方式 |
| roofType | 平屋顶、坡屋顶、组合屋顶、未知 |
| facadeMaterial / facadeColor | 外立面主要材料和主色，按现场观察填写 |
| photoNorth/East/South/West | 对应照片文件名或相对路径 |
| photoEntrance / photoRoof / photoCorners / photoOther | 入口、屋顶、转角及补充照片文件名或路径 |
| observedStatus | 在用、施工、停用、拆除、无法确认 |
| surveyDate / surveyor | 采集日期（YYYY-MM-DD）和采集人 |
| confidence | high：有可靠测量/官方图纸并现场核对；medium：现场观察较完整但部分数据估算；low：仅远观或资料推断 |
| issuesToVerify | 名称、位置、尺寸、楼层等待核验问题 |
| reviewer / reviewDate | 复核人和复核日期 |
| notes | 其他情况、测量口径、特殊结构等 |

## 3. 照片命名规范

建议按以下格式命名：

`{buildingId}_{方向或类型}_{YYYYMMDD}_{序号}.jpg`

示例：
- `B001_N_20261102_01.jpg`
- `B001_E_20261102_01.jpg`
- `B001_entrance_20261102_01.jpg`
- `B001_roof_20261102_01.jpg`
- `B001_corner_20261102_01.jpg`

照片路径写入 CSV 对应字段；原图集中保存，不要只保留压缩后的聊天软件图片。

## 4. 单栋建筑采集检查清单

- [ ] 核对楼牌/正式名称
- [ ] 确认建筑独立边界，建筑群已拆分
- [ ] 记录位置坐标和坐标来源
- [ ] 记录 footprint 转角或长宽
- [ ] 记录地上层数及高度依据
- [ ] 记录主入口方向、建筑朝向
- [ ] 采集四向立面照片
- [ ] 采集入口、屋顶可见部分和主要转角照片
- [ ] 填写置信度及待核验问题
- [ ] 完成复核或标记待复核

## 5. 与三维模型数据的衔接

实地采集完成后，先复核并清洗数据，再转换为校园本地米制坐标，最后用于 `public/data/buildings.json` 和 GLB 模型清单。未经复核的数据不得直接作为正式建筑模型坐标。

当前表格是采集记录模板，不代表任何建筑的实测数据已经完成。
