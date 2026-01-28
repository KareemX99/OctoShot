import os

content = '''{% extends 'booking/base.html' %}
{% load static i18n i18n_fields %}

{% block title %}{% trans "المنتجات" %} | Ibraheem Mahsob{% endblock %}

{% block extra_css %}
<link rel="stylesheet" href="{% static 'css/pages.css' %}">
{% endblock %}

{% block content %}
<!-- Page Hero -->
<section class="page-hero">
    <div class="page-hero-bg"></div>
    <div class="container">
        <div class="page-hero-content">
            <span class="hero-badge">— {% trans "المنتجات" %} —</span>
            <h1>{% trans "منتجاتنا" %}</h1>
            <p>{% trans "منتجات فاخرة للعناية بالشعر واللحية" %}</p>
        </div>
    </div>
</section>

<!-- Products Categories -->
<section class="products-section">
    <div class="container">
        <!-- Categories Filter -->
        <div class="products-filter">
            <button class="filter-btn active" data-category="all">{% trans "الكل" %}</button>
            {% for cat_key, cat_name in categories %}
            <button class="filter-btn" data-category="{{ cat_key }}">{{ cat_name }}</button>
            {% endfor %}
        </div>

        <!-- Products Grid -->
        <div class="products-grid" id="productsGrid">
            {% for product in products %}
            <div class="product-card" data-category="{{ product.category }}">
                <div class="product-image">
                    <span class="product-category-tag">{{ product.get_category_display }}</span>
                    <div class="product-placeholder">
                        {% if product.image %}
                        <img src="{{ product.image.url }}" alt="{{ product.name }}">
                        {% else %}
                        <span class="placeholder-icon">{{ product.icon }}</span>
                        {% endif %}
                    </div>
                </div>
                <div class="product-info">
                    <h3>{{ product|localized_field:'name' }}</h3>
                    <p>{{ product|localized_field:'description'|truncatewords:10 }}</p>
                    <div class="product-card-footer">
                        <span class="product-price">{{ product.price }} {% currency %}</span>
                        <button class="product-btn" onclick="openProductModal({{ product.id }})">{% if LANGUAGE_CODE == 'en' %}Details{% else %}التفاصيل{% endif %}</button>
                    </div>
                </div>
            </div>
            {% empty %}
            <div class="empty-state">
                <span class="empty-icon">📦</span>
                <p>{% trans "لا توجد منتجات حالياً" %}</p>
            </div>
            {% endfor %}
        </div>
    </div>
</section>

<!-- Product Modal -->
<div class="modal" id="productModal">
    <div class="modal-content product-modal-content">
        <button class="modal-close" onclick="closeProductModal()">×</button>
        <div class="product-modal-grid">
            <div class="product-modal-image">
                <div class="product-image-placeholder" id="modalProductImage">
                    <span id="modalProductIcon">💈</span>
                </div>
            </div>
            <div class="product-modal-info">
                <span class="product-category" id="modalProductCategory">—</span>
                <h2 id="modalProductName">—</h2>
                <p class="product-description" id="modalProductDesc">—</p>
                <div class="product-price-large" id="modalProductPrice">—</div>
                <div class="product-features">
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>{% trans "منتج أصلي 100%" %}</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>{% trans "جودة عالية" %}</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">✓</span>
                        <span>{% trans "متوفر في الصالون" %}</span>
                    </div>
                </div>
                <a href="{% url 'booking:booking' %}" class="btn btn-primary">{% trans "احجز واحصل عليه" %}</a>
            </div>
        </div>
    </div>
</div>

<!-- CTA Section -->
<section class="cta-section">
    <div class="container">
        <div class="cta-content">
            <h2>هل تريد تجربة {% trans "منتجاتنا" %}؟</h2>
            <p>{% trans "احجز موعدك الآن واحصل على استشارة مجانية من خبرائنا" %}</p>
            <a href="{% url 'booking:booking' %}" class="btn btn-primary">{% trans "احجز الآن" %}</a>
        </div>
    </div>
</section>
{% endblock %}

{% block extra_js %}
<script>
    const productsData = [
        {% for product in products %}
        {
            id: {{ product.id }},
            name: "{{ product|localized_field:'name'|escapejs }}",
            description: "{{ product|localized_field:'description'|escapejs }}",
            category: "{{ product.category }}",
            categoryDisplay: "{{ product.get_category_display|escapejs }}",
            price: "{{ product.price }}",
            icon: "{{ product.icon|escapejs }}",
            image: {% if product.image %}"{{ product.image.url }}"{% else %}null{% endif %}
        }{% if not forloop.last %},{% endif %}
        {% endfor %}
    ];

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const category = btn.dataset.category;
            const cards = document.querySelectorAll('.product-card');
            cards.forEach(card => {
                if (category === 'all' || card.dataset.category === category) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });

    function openProductModal(id) {
        const product = productsData.find(p => p.id === id);
        if (product) {
            document.getElementById('modalProductCategory').textContent = product.categoryDisplay;
            document.getElementById('modalProductName').textContent = product.name;
            document.getElementById('modalProductDesc').textContent = product.description;
            document.getElementById('modalProductPrice').textContent = product.price + ' {% currency %}';
            const imageContainer = document.getElementById('modalProductImage');
            if (product.image) {
                imageContainer.innerHTML = '<img src="' + product.image + '" alt="' + product.name + '" style="max-width:100%; border-radius:8px;">';
            } else {
                imageContainer.innerHTML = '<span style="font-size:60px;">' + product.icon + '</span>';
            }
            document.getElementById('productModal').classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }

    function closeProductModal() {
        document.getElementById('productModal').classList.remove('active');
        document.body.style.overflow = '';
    }

    document.getElementById('productModal').addEventListener('click', (e) => {
        if (e.target.id === 'productModal') {
            closeProductModal();
        }
    });
</script>
{% endblock %}
'''

target_path = r'D:\Ibraheem mahsob\ibraheem-mahsoob\barbershop\booking\templates\booking\products.html'
with open(target_path, 'w', encoding='utf-8') as f:
    f.write(content)
print('File written successfully to:', target_path)
