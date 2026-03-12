# ATEL 测试服务器访问配置指南

## 一、服务器信息

- **IP地址：** 39.102.61.79
- **用户名：** root
- **认证方式：** SSH 密钥认证（禁用密码登录）

---

## 二、配置 SSH 访问

### 步骤 1：生成 SSH 密钥对（如果还没有）

```bash
# 检查是否已有密钥
ls -la ~/.ssh/id_rsa.pub

# 如果没有，生成新密钥
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# 按提示操作：
# 1. 文件位置：直接回车（使用默认 ~/.ssh/id_rsa）
# 2. 密码：可以设置或留空（留空更方便）
```

### 步骤 2：获取你的公钥

```bash
cat ~/.ssh/id_rsa.pub
```

**输出示例：**
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC... your_email@example.com
```

### 步骤 3：发送公钥给管理员

**将上面的公钥（完整的一行）发送给 Lawrence，格式如下：**

```
姓名：张三
邮箱：zhangsan@example.com
公钥：
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC... zhangsan@example.com
```

### 步骤 4：等待管理员添加

管理员会将你的公钥添加到服务器的 `~/.ssh/authorized_keys` 文件中。

### 步骤 5：测试连接

```bash
ssh root@39.102.61.79
```

**成功登录后会看到：**
```
Welcome to Alibaba Cloud Elastic Compute Service !
```

---

## 三、管理员操作（仅供 Lawrence 参考）

### 添加团队成员公钥

```bash
# 登录服务器
ssh root@39.102.61.79

# 编辑 authorized_keys
vim ~/.ssh/authorized_keys

# 添加新成员的公钥（每个公钥一行）
# 保存并退出

# 验证权限
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

### 删除团队成员访问权限

```bash
# 编辑 authorized_keys
vim ~/.ssh/authorized_keys

# 删除对应的公钥行
# 保存并退出
```

---

## 四、常用操作

### 1. 查看服务状态

```bash
ssh root@39.102.61.79 "pm2 list"
```

### 2. 查看服务日志

```bash
ssh root@39.102.61.79 "pm2 logs atel-platform-test --lines 50"
```

### 3. 重启服务

```bash
ssh root@39.102.61.79 "pm2 restart atel-platform-test"
```

### 4. 查看数据库

```bash
ssh root@39.102.61.79 "psql -U atel -d atel -c 'SELECT * FROM agents LIMIT 10;'"
```

### 5. 上传文件

```bash
scp local-file.txt root@39.102.61.79:/opt/atel/
```

### 6. 下载文件

```bash
scp root@39.102.61.79:/opt/atel/file.txt ./
```

---

## 五、安全注意事项

### ⚠️ 重要规则

1. **不要分享私钥（id_rsa）**
   - 只分享公钥（id_rsa.pub）
   - 私钥必须保密

2. **不要在服务器上运行未经审查的代码**
   - 所有代码改动必须通过 PR
   - 测试环境也要谨慎操作

3. **不要删除生产数据**
   - 测试环境的数据库是独立的
   - 但仍要小心操作

4. **不要修改系统配置**
   - 不要改 SSH 配置
   - 不要改防火墙规则
   - 不要改数据库配置

5. **使用完毕后退出登录**
   ```bash
   exit
   ```

---

## 六、SSH 配置优化（可选）

### 创建 SSH 配置文件

```bash
# 编辑 ~/.ssh/config
vim ~/.ssh/config

# 添加以下内容
Host atel-test
    HostName 39.102.61.79
    User root
    IdentityFile ~/.ssh/id_rsa
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

### 使用简化命令

```bash
# 之前
ssh root@39.102.61.79

# 现在
ssh atel-test
```

---

## 七、常见问题

### Q1: Permission denied (publickey)

**原因：** 公钥未添加或私钥路径不对

**解决：**
1. 确认公钥已发送给管理员
2. 确认管理员已添加
3. 检查私钥路径：`ls -la ~/.ssh/id_rsa`

### Q2: Connection refused

**原因：** 服务器防火墙或网络问题

**解决：**
1. 检查网络连接
2. 联系管理员检查防火墙

### Q3: Host key verification failed

**原因：** 服务器密钥变更

**解决：**
```bash
ssh-keygen -R 39.102.61.79
```

### Q4: 如何修改密钥密码？

```bash
ssh-keygen -p -f ~/.ssh/id_rsa
```

---

## 八、团队成员列表（管理员维护）

| 姓名 | 邮箱 | 公钥指纹 | 添加日期 | 状态 |
|------|------|---------|---------|------|
| Lawrence | lawrence@example.com | SHA256:xxx... | 2026-03-10 | ✅ 活跃 |
| （待添加） | - | - | - | - |

---

## 九、快速参考

### 发送公钥给管理员

```bash
# 1. 生成密钥（如果没有）
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# 2. 查看公钥
cat ~/.ssh/id_rsa.pub

# 3. 复制完整输出，发送给 Lawrence
```

### 测试连接

```bash
ssh root@39.102.61.79
```

### 常用命令

```bash
# 查看服务
ssh root@39.102.61.79 "pm2 list"

# 查看日志
ssh root@39.102.61.79 "pm2 logs atel-platform-test"

# 重启服务
ssh root@39.102.61.79 "pm2 restart atel-platform-test"
```

---

**更新时间：** 2026-03-11
**维护者：** Lawrence
**联系方式：** [你的联系方式]
