FROM php:8.3-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends libxml2-dev libpng-dev libjpeg-dev libfreetype6-dev libcurl4-openssl-dev libzip-dev libonig-dev unzip git openssl \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install -j"$(nproc)" soap gd zip mbstring bcmath \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public \
    TZ=America/Sao_Paulo
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
 && printf 'ServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-available/hardening.conf && a2enconf hardening \
 && printf 'expose_php=0\ndisplay_errors=0\nlog_errors=1\ndate.timezone=America/Sao_Paulo\n' > /usr/local/etc/php/conf.d/emitter.ini

WORKDIR /var/www/html
COPY composer.json ./
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader
COPY public ./public
COPY src ./src

# Apache repassa o header Authorization ao PHP
RUN printf 'SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1\n' > /etc/apache2/conf-available/auth-header.conf && a2enconf auth-header
RUN mkdir -p /var/lib/deepshop-nfe && chown -R www-data:www-data /var/lib/deepshop-nfe
EXPOSE 80
