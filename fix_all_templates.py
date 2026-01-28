import re
import os

def fix_template_file(file_path):
    """Fix all split Django template tags in a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original = content
        
        # Helper to clean up matched tags
        def clean_tag(match):
            return re.sub(r'\s+', ' ', match.group(0))

        # Fix split {% if ... %}
        content = re.sub(
            r'\{%\s*if[^%]*?%\}',
            clean_tag,
            content,
            flags=re.DOTALL
        )
        
        # Fix split {% else %}
        content = re.sub(
            r'\{%\s*else\s*%\}',
            '{% else %}',
            content,
            flags=re.DOTALL
        )
        
        # Fix split {% endif %}
        content = re.sub(
            r'\{%\s*endif\s*%\}',
            '{% endif %}',
            content,
            flags=re.DOTALL
        )

        # Fix split {% trans ... %}
        content = re.sub(
            r'\{%\s*trans[^%]*?%\}',
            clean_tag,
            content,
            flags=re.DOTALL
        )
        
        if content != original:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Fixed: {file_path}')
            return True
        else:
            print(f'No changes needed: {file_path}')
            return False
    except Exception as e:
        print(f'Error fixing {file_path}: {e}')
        return False

# Fix all template files including contactus.html
template_dir = r'D:\Ibraheem mahsob\ibraheem-mahsoob\barbershop\booking\templates\booking'

files_to_fix = [
    'products.html',
    'services_page.html',
    'offers.html',
    'about.html',
    'contactus.html', 
]

print('Starting template fixes...')
for filename in files_to_fix:
    file_path = os.path.join(template_dir, filename)
    if os.path.exists(file_path):
        fix_template_file(file_path)
    else:
        print(f'File not found: {file_path}')

print('Done!')
