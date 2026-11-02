# 仿射配准约定

输入为底图像素坐标，输出为 campus-local 局部平面坐标：
x'=a*x+b*y+c；y'=d*x+e*y+f。

至少 3 组控制点，source 点必须不共线。恰好 3 点解唯一变换，多于 3 点用最小二乘。输出六参数、每个控制点 dx/dy/欧氏残差和 RMSE。RMSE 单位等于目标坐标单位；控制点拟合误差不能单独证明真实地理精度，建议保留独立检查点。

建议将 registration 与 baseMapTransform 分开持久化，记录 schemaVersion、算法版本、source/target 坐标系、控制点、变换参数、RMSE、残差、创建人/时间和质量状态。底图渲染与要素坐标采集必须共用同一变换模块。当前算法不推断 CRS 或物理单位；不得将 campus-local 伪装为 EPSG:4326。
