# 项目介绍
该项目是一个AI终端应用，该项目运行后，可在终端启动。辅助用户进行开发，类似于Claude Code。
# 项目技术栈
使用node.js配合node的一些库进行开发，请求大模型接口用的是openai。项目开发使用js，不是用ts。
# 项目的目录接口
[./src]("项目的代码存放处")
[./src/app.js]("项目的启动文件，通过运行该文件启动项目")
[./src/docs]("项目携带给大模型接口的文档模板放在这里面")
[./src/tool]("项目的本地functiontool到时候读取tools里的内容给到大模型接口")
[./src/utils]("项目代码里用到的一些工具函数存放处")
[./src/request]("项目代码发送异步请求的地方")
# 项目额外规范
1.项目使用的是esmoudle规范，而不是commonjs规范。
2.项目使用的js，而不是ts。
3.注意扫描package.json，如果有没有安装的包，请使用npm install安装。