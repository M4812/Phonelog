电话记录管理系统 - Windows Server 2012 R2 免安装部署说明

适用范围
1. 适用于 Windows Server 2012 R2 x64 及更新的 64 位 Windows 服务器。
2. 发布包内置 Node.js 16.20.2 win-x64 运行时，目标服务器不需要安装 Node.js、npm 或开发环境。

运行方法
1. 将整个发布包解压到服务器目录，例如 D:\phone-record-app。
2. 双击 start-windows.bat。
3. A 服务器本机可以访问 http://localhost:3000。
4. B 服务器或其他电脑访问 http://A服务器IP:3000，即可看到和 A 服务器相同的页面和记录。

数据共享说明
1. 所有访问者都连接 A 服务器正在运行的服务。
2. 新增、删除、修改都会写入 A 服务器发布目录下的 data\records.json。
3. B 服务器不需要拷贝 data 文件夹，也不需要单独启动服务；只要浏览器访问 A 服务器 IP 和端口即可。
4. 如果在 B 服务器也启动了一份服务，那 B 会拥有自己的 data\records.json，这不是共享访问方式。

防火墙
1. 如果 A 服务器本机可打开，但 B 服务器打不开，通常是 Windows 防火墙未放行端口。
2. 右键 allow-firewall-port-3000-admin.bat，选择“以管理员身份运行”。
3. 如果修改了端口，需要手动按新端口放行 TCP 入站规则。

修改端口
1. 默认端口是 3000。
2. 可以在命令行进入发布目录后运行：
   set PORT=8080
   start-windows.bat
3. 其他电脑访问地址也要改成新端口，例如 http://A服务器IP:8080。

数据与备份
1. 数据文件位于 data\records.json。
2. 备份时复制整个 data 文件夹即可。
3. 不要在程序运行时手动编辑 records.json，避免写入冲突。

停止服务
1. 在启动窗口按 Ctrl+C。
2. 看到是否终止批处理操作时输入 Y 并回车。

常见问题
1. 双击闪退：请在命令行中运行 start-windows.bat 查看错误信息。
2. 端口被占用：换一个端口启动，例如 PORT=8080。
3. 同网段无法访问：确认 A 服务器 IP 正确、双方网络互通、Windows 防火墙已放行 TCP 端口。
4. B 服务器看不到 A 的数据：确认 B 浏览器地址栏是 http://A服务器IP:端口，而不是 localhost 或 B 自己的 IP。
