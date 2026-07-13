import re
from pathlib import Path

for md in [Path(r"F:/WhisperSubtitle/docs/architecture/技术文档.md"), Path(r"C:/Users/Administrator/Desktop/Obsidian仓库/Python项目库/Project_Whisper_Python/技术文档.md")]:
    text = md.read_text(encoding='utf-8')
    def fix_attr(m):
        return 'class="' + re.sub(r'\b(\d{2}-)(?=[a-zA-Z])', r'a\1', m.group(1)) + '"'
    text = re.sub(r'class="([^"]*)"', fix_attr, text)
    text = re.sub(r'\.(\d{2}-)([a-zA-Z])', r'.a\1\2', text)
    md.write_text(text, encoding='utf-8')
    print("fixed:", md)
