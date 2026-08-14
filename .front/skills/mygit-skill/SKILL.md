---
name: mygit-skill
description：当用户让你进行git提交的时候，一定要遵循此skill的规则
---
# 操作步骤
1. 通过git add.把所有的文件加入晢存区。
2. 如果缓冲区有还有文件，继续执行第一步。当缓冲区没有文件时，执行git commit -m"理由"。
**关于理由** 
理由一定是fix/feat/debugger: 文本。fix为bug修复，feat为新增功能，debugger为调试。文本通过扫描用户的提交内容，自动生成
