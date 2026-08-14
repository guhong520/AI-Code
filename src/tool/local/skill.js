import fs from 'fs';
import path from 'path';
export const toolList = [
    {
        type: "function",
        function: {
            name: "skill",
            description: "加载skill的详情时使用",
            parameters: {
                type: "object",
                properties: {
                    skillpath: {
                        type: "string",
                        description: "要加载的skill的路径"
                    }
                },
                required: ["skillpath"]
            }
        }
    }
];
export const toolMap = {
    skill: ({ skillpath }) => {
        const content = fs.readFileSync(path.resolve(skillpath), "utf-8");
        return `skill的内容为：${content}`;
    }
}    
